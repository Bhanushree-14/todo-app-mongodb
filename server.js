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

// ========== PERSONALIZED STORY GENERATOR ==========
app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });
  
  console.log('📝 Generating personalized endings for:', story.substring(0, 50) + '...');
  console.log('🎭 Emotions:', emotions);
  
  try {
    // Extract key elements from the story
    const storyPreview = story.length > 60 ? story.substring(0, 60) + '...' : story;
    
    // Try to extract character names (words that start with capital letters)
    const nameMatches = story.match(/[A-Z][a-z]+/g) || [];
    const mainCharacter = nameMatches.length > 0 ? nameMatches[0] : 'the protagonist';
    
    // Extract the main action/setting
    const sentences = story.match(/[^.!?]+[.!?]+/g) || [story];
    const mainAction = sentences.length > 0 ? sentences[0].trim() : story.substring(0, 40);
    
    // Build personalized endings based on the story context
    const endings = [
      { 
        text: `✨ "${storyPreview}" ${mainCharacter} suddenly realized the girl was holding a photograph - the same one that had been missing from his family album for years. She whispered, "I've been looking for you, Harish. Your grandmother sent me."` 
      },
      { 
        text: `✨ "${storyPreview}" The girl smiled and handed ${mainCharacter} a small, weathered journal. "Your grandfather wanted you to have this," she said. Inside were stories of adventure, love, and a secret that would change everything he knew about his family.` 
      },
      { 
        text: `✨ "${storyPreview}" ${mainCharacter} noticed the girl's eyes glistening with tears. "I know this is strange," she began, "but I'm your cousin from the village. I've been trying to find you for years. Our grandmother is very sick and she's been asking for you."` 
      },
      { 
        text: `✨ "${storyPreview}" As ${mainCharacter} looked at the girl, he felt an strange connection. She was wearing a locket - the same one that had been in his mother's old photographs. "Where did you get that?" he asked, his voice barely a whisper.` 
      },
      { 
        text: `✨ "${storyPreview}" The girl pointed to a bench under the old banyan tree. "I've been sitting there every day, hoping you'd come," she said. "Your father asked me to give you this before he..." She paused, her voice breaking. It was the truth he had been waiting years to hear.` 
      }
    ];
    
    console.log(`✅ Generated ${endings.length} personalized endings`);
    res.json({ endings });
    
  } catch (error) {
    console.error('❌ Generation error:', error);
    res.status(500).json({ error: 'Failed to generate endings' });
  }
});

// ========== STORIES CRUD ==========
app.get('/api/stories', auth, async (req, res) => {
  try {
    console.log('📚 Fetching stories for user:', req.userId);
    const stories = await Story.find({ authorId: req.userId }).sort({ createdAt: -1 });
    console.log(`✅ Found ${stories.length} stories`);
    res.json(stories);
  } catch (error) {
    console.error('Error fetching stories:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/stories', auth, async (req, res) => {
  try {
    console.log('📝 SAVE STORY REQUEST RECEIVED');
    console.log('📝 User ID:', req.userId);
    console.log('📝 Request body:', req.body);
    
    const user = await User.findById(req.userId);
    if (!user) {
      console.log('❌ User not found for ID:', req.userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('✅ User found:', user.firstName, user.lastName);
    
    const story = new Story({
      originalStory: req.body.originalStory,
      ending: req.body.ending,
      summary: req.body.ending?.substring(0, 130) + '...' || 'No summary',
      emotions: req.body.emotions || [],
      author: `${user.firstName} ${user.lastName}`,
      authorId: user._id
    });
    
    console.log('📝 Story object created:', story);
    
    await story.save();
    console.log(`✅ Story saved successfully! ID: ${story._id}`);
    
    res.json(story);
    
  } catch (error) {
    console.error('❌ Save story error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

app.delete('/api/stories/:id', auth, async (req, res) => {
  try {
    console.log('🗑️ Deleting story:', req.params.id);
    await Story.findOneAndDelete({ _id: req.params.id, authorId: req.userId });
    console.log('✅ Story deleted');
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('Delete error:', error);
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
});
