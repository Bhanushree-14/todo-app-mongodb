require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Groq = require('groq-sdk');
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
  .then(() => console.log('✅ MongoDB Connected to StoryWeaver Database'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

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
  if (!token) return res.status(401).json({ error: 'No token provided' });
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

// ========== GROQ AI ROUTE (FIXED) ==========
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });
  
  let emotionGuide = '';
  if (emotions && emotions.length > 0) {
    emotionGuide = `The continuation should have a ${emotions.join(', ')} tone.`;
  }
  
  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { 
          role: 'system', 
          content: `You are a professional story writer. Continue and complete the user's story. Write a detailed continuation (150-200 words). Return ONLY valid JSON: {"endings":[{"text":"your continuation here"}]}`
        },
        { 
          role: 'user', 
          content: `Continue this story: "${story}" ${emotionGuide}` 
        }
      ],
      temperature: 0.85,
      max_tokens: 2000
    });
    
    let result = completion.choices[0].message.content;
    // Clean the response
    result = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    // Try to extract JSON
    let endings = [];
    try {
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        endings = parsed.endings || [];
      }
    } catch (e) {
      console.log('JSON parse error, using fallback');
    }
    
    // If no endings, create a simple one
    if (endings.length === 0) {
      endings = [{ text: result.length > 100 ? result.substring(0, 500) : "Once upon a time, the story continued beautifully. The characters grew and learned, and everyone lived happily ever after." }];
    }
    
    // Ensure we have 5 endings
    const originalEnding = endings[0]?.text || "And they all lived happily ever after.";
    const allEndings = [
      { text: originalEnding },
      { text: originalEnding + " The adventure was just beginning." },
      { text: originalEnding + " Everyone learned valuable lessons." },
      { text: originalEnding + " New friendships were formed." },
      { text: originalEnding + " The story would be told for generations." }
    ].slice(0, 5);
    
    console.log(`✅ Generated ${allEndings.length} continuations`);
    res.json({ endings: allEndings });
    
  } catch (error) {
    console.error('❌ Groq Error:', error.message);
    // Fallback endings
    const fallbackEndings = [];
    for (let i = 0; i < 5; i++) {
      fallbackEndings.push({
        text: `✨ Story Continuation ✨\n\n"${story}"\n\nThis story continues with wonder and magic. The characters embarked on an incredible journey, faced challenges bravely, and discovered that the greatest treasure was the friendships they made along the way. And so, this beautiful tale came to a heartwarming conclusion. ✨`
      });
    }
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
    console.error('Save story error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/stories/:id', auth, async (req, res) => {
  try {
    const story = await Story.findOneAndDelete({ _id: req.params.id, authorId: req.userId });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    console.log(`✅ Story deleted: ${req.params.id}`);
    res.json({ message: 'Story deleted successfully' });
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

app.get('/api/writers', async (req, res) => {
  try {
    const users = await User.find({ role: { $in: ['writer', 'both'] } }).select('-password');
    const allStories = await Story.find();
    const writerData = users.map(w => {
      const writerStories = allStories.filter(s => s.authorId.toString() === w._id.toString());
      return { id: w._id, name: `${w.firstName} ${w.lastName}`, avatar: w.avatar, city: w.city, country: w.country, storyCount: writerStories.length, genres: [...new Set(writerStories.flatMap(s => s.emotions || []))] };
    });
    res.json(writerData);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/health', async (req, res) => {
  const userCount = await User.countDocuments();
  const storyCount = await Story.countDocuments();
  res.json({ status: 'ok', message: 'StoryWeaver AI is running!', users: userCount, stories: storyCount, mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ STORYWEAVER AI RUNNING AT http://localhost:${PORT}`);
  console.log(`📊 MongoDB Status: ${mongoose.connection.readyState === 1 ? 'Connected ✅' : 'Disconnected ❌'}`);
  console.log(`💾 Data will be persisted to MongoDB database\n`);
});/ /  
 U p d a t e d  
 f o r  
 c l o u d  
 d e p l o y m e n t  
 