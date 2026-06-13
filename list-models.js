const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = 'AIzaSyBNSdhfvxAmam1_NZeMCAWzOUFPhXoggkw';

async function listModels() {
    const genAI = new GoogleGenerativeAI(API_KEY);
    try {
        const models = await genAI.listModels();
        console.log("Available models for your API key:");
        for (let i = 0; i < models.length; i++) {
            console.log("  - " + models[i].name);
        }
    } catch (error) {
        console.error("Error:", error.message);
    }
}

listModels();