
const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 5000;

// Gemini APIキーの取得
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY is not set in .env file');
  process.exit(1);
}

// Geminiモデルの初期化
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const getSystemInstruction = (patientType) => {
  if (patientType === 'new') {
    return `あなたは初めて糖尿病と診断された患者です。看護師の指導に対して、不安な気持ちや分からないことを質問してください。`;
  } else if (patientType === 'compliance') {
    return `あなたは糖尿病で入退院を繰り返しているコンプライアンスの悪い患者です。看護師の指導に対して、「そんなことできないよ」「分からない」など否定的な気持ちを表出してください。`;
  }
  return `あなたは糖尿病患者です。看護師の指導に答えてください。`; // デフォルト
};

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

// チャットメッセージを受信し、AIの応答を返すAPIエンドポイント
app.post('/api/chat', async (req, res) => {
  const { messages, patientType } = req.body; // patientTypeも受け取る
  console.log('Received conversation history:', messages);
  console.log('Patient Type:', patientType);

  try {
    // Gemini APIに渡すメッセージ形式に変換
    // 最初のAIメッセージと最後のユーザーメッセージを除外して履歴を構築
    const history = messages.slice(1, messages.length - 1).map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }],
    }));

    const systemInstruction = getSystemInstruction(patientType);

    const chat = model.startChat({
      history,
      systemInstruction: { parts: [{ text: systemInstruction }] }
    });
    const result = await chat.sendMessage(messages[messages.length - 1].text);
    const response = await result.response;
    const aiResponse = response.text();

    res.json({ reply: aiResponse });
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    res.status(500).json({ reply: 'AIからの応答中にエラーが発生しました。' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
});

// 指導内容を評価するAPIエンドポイント
app.post('/api/evaluate', async (req, res) => {
  const { messages, patientType } = req.body;
  console.log('Received messages for evaluation:', messages);
  console.log('Patient Type for evaluation:', patientType);

  try {
    const conversationSummary = messages.map(msg => `${msg.sender === 'user' ? '看護師' : '患者'}: ${msg.text}`).join('\n');

    const evaluationPrompt = `あなたは糖尿病療養指導シミュレーターの評価者です。看護師の成長を支援するため、建設的かつ公平なフィードバックを提供してください。
以下の会話履歴は、看護師（プレイヤー）と糖尿病患者（AI）の間の指導セッションです。
患者のタイプは「${patientType === 'new' ? '初めて糖尿病と診断された患者' : '入退院を繰り返すコンプライアンスの悪い患者'}」です。

会話履歴:
${conversationSummary}

以下の基準に基づいて、看護師の指導を100点満点で評価し、具体的なフィードバックを提供してください。

**良い点:** 患者に寄り添った共感的な姿勢、適切な情報提供、効果的なコミュニケーションなど、優れていた点を具体的に評価し、積極的に褒めてください。これらの点は点数に反映しますが、**誤った指導があった場合は、その影響を上回ることはありません。**

**改善点:** 誤った指導や不適切な指導があった場合は、その点を明確に指摘し、**糖尿病診療ガイドライン（https://www.jds.or.jp/modules/publication/index.php?content_id=4）を根拠に**なぜそれが不適切なのかを詳細に説明してください。誤った指導があった場合、点数は厳しく減点し、低く設定してください。

フィードバックは、良い点と改善点の両方をバランス良く記述し、看護師が次回の指導に活かせるような具体的な内容にしてください。

出力はJSON形式でお願いします。
{
  "score": (点数, 0-100),
  "feedback": "具体的なフィードバック。良い点と改善点（誤った指導の指摘と根拠を含む）をバランス良く記述。"
}`; // JSON形式で出力するように指示

    const result = await model.generateContent(evaluationPrompt);
    const response = await result.response;
    const evaluationText = response.text();

    // Geminiからの応答がJSON形式であることを期待してパース
    const cleanedEvaluationText = evaluationText.replace(/```json\n|```/g, ''); // Remove markdown code block
    const evaluationResult = JSON.parse(cleanedEvaluationText);

    res.json(evaluationResult);
  } catch (error) {
    console.error('Error during evaluation:', error);
    res.status(500).json({ score: 0, feedback: '評価中にエラーが発生しました。' });
  }
});
