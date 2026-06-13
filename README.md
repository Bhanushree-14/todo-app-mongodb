# StoryWeaver AI ✍️✨

StoryWeaver AI is an interactive, full-stack storytelling platform that uses Artificial Intelligence to turn simple ideas into immersive narratives. It is designed to bridge the gap between imagination and the written word.

## 🌟 Key Features

- **AI-Powered Continuations:** Leverages the **Llama 3.3 70B** model via Groq to generate 5 distinct, high-quality story paths for any user prompt.
- **Voice-to-Text Input:** Don't feel like typing? Use the integrated **Voice Input** feature to dictate your story ideas naturally.
- **Audio Storytelling:** Includes a **Listen** feature that reads the AI-generated stories back to you, creating a hands-free experience.
- **Emotional Intelligence:** Users can select specific emotions (Adventurous, Spooky, Heartwarming) to influence the AI's writing style.
- **Personal Library:** Secure user authentication allows you to save, edit, and delete your favorite generated stories.

## 🛠️ Technical Architecture



- **Frontend:** Responsive HTML5, CSS3, and Vanilla JavaScript.
- **Backend:** Node.js & Express.js.
- **AI Integration:** [Groq Cloud SDK](https://console.groq.com/).
- **Database:** MongoDB Atlas for persistent storage of users and stories.
- **Security:** Industry-standard JWT for session management and Bcrypt for password hashing.

## 🚀 Getting Started

1. **Clone the project:** `git clone https://github.com/Bhanushree-14/storyweaver-ai.git`
2. **Install dependencies:** `npm install`
3. **Setup Environment:** Create a `.env` file with your `GROQ_API_KEY`, `MONGODB_URI`, and `JWT_SECRET`.
4. **Run:** `node server.js`
