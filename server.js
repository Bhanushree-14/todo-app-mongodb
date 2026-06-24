require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ========== MONGODB CONNECTION ==========
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/storyweaver';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ========== MONGODB SCHEMAS ==========
const userSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  city: { type: String, default: '' },
  country: { type: String, default: '' },
  role: { type: String, default: 'writer' },
  avatar: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const storySchema = new mongoose.Schema({
  originalStory: { type: String, required: true },
  ending: { type: String, required: true },
  summary: { type: String, default: '' },
  emotions: { type: [String], default: [] },
  author: { type: String, required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Story = mongoose.model('Story', storySchema);

// ========== MIDDLEWARE ==========
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.userId = decoded.userId;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== AUTH ROUTES ==========
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, city, country, role } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'User already exists' });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ firstName, lastName, email, password: hashedPassword, city: city || '', country: country || '', role: role || 'writer', avatar: firstName.charAt(0).toUpperCase() });
    await user.save();
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, firstName, lastName, email, fullName: `${firstName} ${lastName}`, avatar: user.avatar } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: 'Invalid credentials' });
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ token, user: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, fullName: `${user.firstName} ${user.lastName}`, avatar: user.avatar } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ...user.toObject(), fullName: `${user.firstName} ${user.lastName}` });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== AI ROUTE - HUGGING FACE (REAL AI) ==========
console.log('🤖 AI Service: Hugging Face (Real AI)');

app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });
  
  let emotionGuide = '';
  if (emotions && emotions.length > 0) {
    emotionGuide = `The continuations should have a ${emotions.join(', ')} tone.`;
  }
  
  try {
    console.log('📤 Calling Hugging Face AI...');
    
    const prompt = `Continue this story with 5 different endings (80-100 words each):\n\nStory: "${story}"\n${emotionGuide}\n\nGenerate 5 different continuations. Return as JSON with an "endings" array containing 5 objects with "text" fields.`;
    
    const response = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.3', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 800,
          temperature: 0.9,
          return_full_text: false
        }
      })
    });
    
    const data = await response.json();
    console.log('📥 Hugging Face responded!');
    
    let generatedText = '';
    if (Array.isArray(data) && data.length > 0) {
      generatedText = data[0].generated_text || '';
    } else if (data.generated_text) {
      generatedText = data.generated_text;
    } else {
      throw new Error('Invalid response from Hugging Face');
    }
    
    // Parse the generated text to extract endings
    let endings = [];
    
    // Try to extract JSON from the response
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.endings && Array.isArray(parsed.endings)) {
          endings = parsed.endings;
        }
      } catch (e) {
        console.log('JSON parse error, using text extraction');
      }
    }
    
    // If no JSON found, extract endings from text
    if (endings.length === 0) {
      // Try to find numbered endings
      const endingRegex = /(?:Ending|Continuation)\s*(\d+)[\s:]+([^.]+\.[^.]*\.[^.]*\.)/gi;
      let match;
      while ((match = endingRegex.exec(generatedText)) !== null) {
        if (endings.length < 5) {
          endings.push({ text: `Continuation ${match[1]}: ${match[2].trim()}` });
        }
      }
      
      // If still no endings, split by common delimiters
      if (endings.length === 0) {
        const parts = generatedText.split(/\n\d+\.|\n-|\n\*/).filter(p => p.trim().length > 20);
        for (const part of parts) {
          if (endings.length < 5) {
            endings.push({ text: `Continuation ${endings.length + 1}: ${part.trim()}` });
          }
        }
      }
    }
    
    // If no endings found, use creative fallback that references the story
    if (endings.length === 0) {
      const preview = story.substring(0, 40);
      endings = [
        { text: `Continuation 1: "${preview}..." The journey continued with unexpected discoveries. The protagonist found courage they never knew they had.` },
        { text: `Continuation 2: "${preview}..." A mysterious stranger appeared and changed everything. The truth was finally revealed.` },
        { text: `Continuation 3: "${preview}..." The adventure deepened with new challenges. Each obstacle made the protagonist stronger.` },
        { text: `Continuation 4: "${preview}..." A powerful choice lay ahead. The decision would shape the future forever.` },
        { text: `Continuation 5: "${preview}..." In the end, the journey was about more than just the destination. It was about who you became along the way.` }
      ];
    }
    
    // Ensure we have exactly 5 endings
    while (endings.length < 5) {
      endings.push({ 
        text: `Continuation ${endings.length + 1}: The story of "${story.substring(0, 30)}..." continued with wonder and discovery.` 
      });
    }
    
    const finalEndings = endings.slice(0, 5);
    console.log(`✅ Generated ${finalEndings.length} endings`);
    res.json({ endings: finalEndings });
    
  } catch (error) {
    console.error('❌ AI Error:', error.message);
    
    // Use story-aware fallback
    const preview = story.substring(0, 40);
    const fallbackEndings = [
      { text: `✨ Continuation 1: "${preview}..." The journey continued with unexpected discoveries. New allies appeared, and the protagonist found the courage to face their greatest fear.` },
      { text: `✨ Continuation 2: "${preview}..." A mysterious turn of events changed everything. A hidden letter revealed a secret that had been buried for years.` },
      { text: `✨ Continuation 3: "${preview}..." The adventure deepened with new challenges. The protagonist discovered an ancient map that promised to lead them to a forgotten treasure.` },
      { text: `✨ Continuation 4: "${preview}..." A powerful choice lay ahead. The protagonist had to decide between duty and desire.` },
      { text: `✨ Continuation 5: "${preview}..." In the end, the truth revealed itself in the most unexpected way. The protagonist realized that the real treasure was the friends they made along the way.` }
    ];
    res.json({ endings: fallbackEndings });
  }
});

// ========== STORIES CRUD ==========
app.get('/api/stories', auth, async (req, res) => {
  try {
    const stories = await Story.find({ authorId: req.userId }).sort({ createdAt: -1 });
    res.json(stories);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/stories', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    const story = new Story({
      originalStory: req.body.originalStory,
      ending: req.body.ending,
      summary: req.body.ending?.substring(0, 130) + '...' || 'No summary',
      emotions: req.body.emotions || [],
      author: `${user.firstName} ${user.lastName}`,
      authorId: user._id
    });
    
    await story.save();
    console.log(`✅ Story saved: ${story._id}`);
    res.json(story);
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/stories/:id', auth, async (req, res) => {
  try {
    await Story.findOneAndDelete({ _id: req.params.id, authorId: req.userId });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/stories/:id', auth, async (req, res) => {
  try {
    const story = await Story.findOne({ _id: req.params.id, authorId: req.userId });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (req.body.originalStory) story.originalStory = req.body.originalStory;
    if (req.body.ending) {
      story.ending = req.body.ending;
      story.summary = req.body.ending.substring(0, 130) + '...';
    }
    await story.save();
    res.json(story);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/health', async (req, res) => {
  const userCount = await User.countDocuments();
  const storyCount = await Story.countDocuments();
  res.json({ status: 'ok', users: userCount, stories: storyCount, mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ STORYWEAVER AI RUNNING ON PORT ${PORT}`);
  console.log(`📊 MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Disconnected ❌'}`);
  console.log(`🤖 AI: Hugging Face (${process.env.HUGGINGFACE_API_KEY ? '✅ Key Loaded' : '❌ Key Missing'})`);
});
