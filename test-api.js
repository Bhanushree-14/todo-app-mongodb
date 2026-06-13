const { GoogleGenerativeAI } = require('@google/generative-ai');

const API_KEY = 'AIzaSyBNSdhfvxAmam1_NZeMCAWzOUFPhXoggkw';
const genAI = new GoogleGenerativeAI(API_KEY);

async function test() {
    // Try gemini-pro first
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });
    
    try {
        const result = await model.generateContent("Say 'Hello, StoryWeaver AI is working!'");
        const response = await result.response;
        console.log("✅ SUCCESS! Response:", response.text());
    } catch (error) {
        console.log("❌ Failed with gemini-pro");
        console.log("Error:", error.message);
        
        // Try gemini-1.5-flash
        console.log("\n Trying gemini-1.5-flash...");
        const model2 = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
        try {
            const result2 = await model2.generateContent("Say 'Working!'");
            const response2 = await result2.response;
            console.log("✅ SUCCESS with gemini-1.5-flash!");
        } catch (error2) {
            console.log("❌ Both models failed. Your API key may be invalid.");
        }
    }
}

test();