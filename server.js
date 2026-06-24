require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

// ========== MONGODB ==========
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/storyweaver';
mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ========== SCHEMAS ==========
const userSchema = new mongoose.Schema({
  firstName:  { type: String, required: true },
  lastName:   { type: String, required: true },
  email:      { type: String, required: true, unique: true },
  password:   { type: String, required: true },
  city:       { type: String, default: '' },
  country:    { type: String, default: '' },
  role:       { type: String, default: 'writer' },
  avatar:     { type: String, default: '' },
  createdAt:  { type: Date, default: Date.now }
});

const storySchema = new mongoose.Schema({
  originalStory: { type: String, required: true },
  ending:        { type: String, required: true },
  summary:       { type: String, default: '' },
  emotions:      { type: [String], default: [] },
  author:        { type: String, required: true },
  authorId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdAt:     { type: Date, default: Date.now }
});

const User  = mongoose.model('User', userSchema);
const Story = mongoose.model('Story', storySchema);

// ========== AUTH MIDDLEWARE ==========
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ========== AUTH ROUTES ==========
app.post('/api/register', async (req, res) => {
  try {
    const { firstName, lastName, email, password, city, country, role } = req.body;
    if (await User.findOne({ email }))
      return res.status(400).json({ error: 'User already exists' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      firstName, lastName, email,
      password: hashedPassword,
      city: city || '', country: country || '',
      role: role || 'writer',
      avatar: firstName.charAt(0).toUpperCase()
    });
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
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: 'Invalid credentials' });
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
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== OPENROUTER HELPER (uses https module — no fetch needed) ==========
function callOpenRouter(apiKey, messages, temperature) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'mistralai/mistral-7b-instruct:free',
      messages,
      max_tokens: 250,
      temperature
    });

    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'HTTP-Referer': 'https://storyweaver-ai.onrender.com',
        'X-Title': 'StoryWeaver AI'
      }
    };

    const req = https.request(options, (resp) => {
      let raw = '';
      resp.on('data', chunk => raw += chunk);
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (resp.statusCode !== 200) {
            reject(new Error('OpenRouter ' + resp.statusCode + ': ' + JSON.stringify(parsed)));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(new Error('Parse error: ' + raw.substring(0, 200)));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ========== AI STORY GENERATION ==========
app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });

  // Sanitize key — strip all whitespace, newlines, quotes
  const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').replace(/[\r\n\t\s'"]/g, '');

  console.log('🔑 Key length:', OPENROUTER_API_KEY.length);
  console.log('🔑 Key starts with:', OPENROUTER_API_KEY.substring(0, 10));

  if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.length < 10) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY missing or invalid.' });
  }

  const emotionText = emotions?.join(', ') || 'general';
  console.log('📝 Story:', story.substring(0, 60) + '...');
  console.log('🎭 Genres:', emotionText);

  async function generateEnding(num) {
    const messages = [
      {
        role: 'system',
        content: `You are a creative story writer. Write ONLY a ${emotionText} story continuation of 100-150 words. Do NOT repeat the story beginning. Do NOT add labels or prefixes. Write naturally.`
      },
      {
        role: 'user',
        content: `Continue this story (write variation ${num}, make it unique and different from other variations):\n\n"${story}"\n\nContinuation:`
      }
    ];

    console.log('📤 Calling OpenRouter for ending', num);
    const data = await callOpenRouter(OPENROUTER_API_KEY, messages, 0.7 + num * 0.08);
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('Empty response for ending ' + num);
    console.log('✅ Ending', num, 'received:', text.substring(0, 60) + '...');
    return { text };
  }

  try {
    const endings = await Promise.all([
      generateEnding(1),
      generateEnding(2),
      generateEnding(3)
    ]);
    console.log('✅ All 3 endings generated successfully');
    res.json({ endings });
  } catch (error) {
    console.error('❌ Generation error:', error.message);
    res.status(500).json({ error: 'AI generation failed: ' + error.message });
  }
});

// ========== STORIES CRUD ==========
app.get('/api/stories', auth, async (req, res) => {
  try {
    const stories = await Story.find({ authorId: req.userId }).sort({ createdAt: -1 });
    console.log('📚 Found', stories.length, 'stories for user', req.userId);
    res.json(stories);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/stories', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { originalStory, ending, emotions } = req.body;
    if (!originalStory || !ending)
      return res.status(400).json({ error: 'originalStory and ending are required' });

    const story = new Story({
      originalStory: originalStory.trim(),
      ending: ending.trim(),
      summary: ending.substring(0, 130) + '...',
      emotions: emotions || [],
      author: `${user.firstName} ${user.lastName}`,
      authorId: user._id
    });

    await story.save();
    console.log('✅ Story saved! ID:', story._id);
    res.json(story);
  } catch (error) {
    console.error('❌ Save story error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.put('/api/stories/:id', auth, async (req, res) => {
  try {
    const story = await Story.findOne({ _id: req.params.id, authorId: req.userId });
    if (!story) return res.status(404).json({ error: 'Story not found' });
    if (req.body.originalStory) story.originalStory = req.body.originalStory;
    if (req.body.ending) {
      story.ending  = req.body.ending;
      story.summary = req.body.ending.substring(0, 130) + '...';
    }
    await story.save();
    res.json(story);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/stories/:id', auth, async (req, res) => {
  try {
    await Story.findOneAndDelete({ _id: req.params.id, authorId: req.userId });
    console.log('✅ Story deleted:', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== HEALTH ==========
app.get('/api/health', async (req, res) => {
  const userCount  = await User.countDocuments();
  const storyCount = await Story.countDocuments();
  const keySet = !!(process.env.OPENROUTER_API_KEY || '').replace(/[\r\n\s]/g, '');
  res.json({
    status: 'ok',
    users: userCount,
    stories: storyCount,
    mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    openrouter_key_set: keySet
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  const keySet = !!(process.env.OPENROUTER_API_KEY || '').replace(/[\r\n\s]/g, '');
  console.log('\n✅ STORYWEAVER AI RUNNING ON PORT', PORT);
  console.log('🤖 OpenRouter Key:', keySet ? 'SET ✅' : 'MISSING ❌');
  console.log('🗄️  MongoDB:', MONGODB_URI.includes('localhost') ? 'Local' : 'Atlas ✅');
});
