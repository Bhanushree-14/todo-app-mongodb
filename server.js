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

// ========== AI ROUTE - USING OPENROUTER (FREE & RELIABLE) ==========
console.log('🤖 AI Service: OpenRouter');

app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });
  
  let emotionGuide = '';
  if (emotions && emotions.length > 0) {
    emotionGuide = `The continuations should have a ${emotions.join(', ')} tone.`;
  }
  
  try {
    console.log('📤 Calling OpenRouter AI...');
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://todo-app-mongodb-1.onrender.com',
        'X-Title': 'StoryWeaver AI'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-lite-preview-02-05:free',
        messages: [
          {
            role: 'system',
            content: `You are a creative story writer. Continue the user's story. Generate 5 different continuations. Each should be 80-100 words.

Return ONLY valid JSON:
{"endings":[
  {"text": "Continuation 1: ..."},
  {"text": "Continuation 2: ..."},
  {"text": "Continuation 3: ..."},
  {"text": "Continuation 4: ..."},
  {"text": "Continuation 5: ..."}
]}`
          },
          {
            role: 'user',
            content: `Continue this story from where it ends: "${story}"\n${emotionGuide}`
          }
        ],
        temperature: 0.9,
        max_tokens: 1500
      })
    });
    
    const data = await response.json();
    console.log('📥 OpenRouter responded!');
    
    let result = data.choices?.[0]?.message?.content || '';
    result = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    let endings = [];
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        endings = parsed.endings || [];
      }
    } catch (e) {
      console.log('JSON parse error:', e.message);
    }
    
    if (endings.length === 0) {
      // Extract any text as endings if JSON fails
      const lines = result.split('\n').filter(l => l.trim());
      endings = lines.map((text, i) => ({ text: `Continuation ${i+1}: ${text}` }));
    }
    
    while (endings.length < 5) {
      endings.push({ text: `Continuation ${endings.length + 1}: The story continued in an unexpected direction.` });
    }
    
    const finalEndings = endings.slice(0, 5);
    console.log(`✅ Generated ${finalEndings.length} endings`);
    res.json({ endings: finalEndings });
    
  } catch (error) {
    console.error('❌ AI Error:', error.message);
    // Smart fallback that uses the user's story
    const storyPreview = story.substring(0, 50);
    const fallbackEndings = [
      { text: `Continuation 1: "${storyPreview}..." The journey continued with unexpected discoveries and challenges.` },
      { text: `Continuation 2: "${storyPreview}..." A mysterious turn of events changed everything for the protagonist.` },
      { text: `Continuation 3: "${storyPreview}..." The adventure deepened with new allies and enemies.` },
      { text: `Continuation 4: "${storyPreview}..." A powerful choice lay ahead that would determine everything.` },
      { text: `Continuation 5: "${storyPreview}..." The truth revealed itself in the most unexpected way.` }
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
  console.log(`🤖 AI Service: OpenRouter (${process.env.OPENROUTER_API_KEY ? '✅ Key Loaded' : '❌ Key Missing'})`);
});
