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

// ========== AI ROUTE ==========
app.post('/api/generate', async (req, res) => {
  const { story, emotions } = req.body;
  if (!story) return res.status(400).json({ error: 'No story provided' });
  
  console.log('📝 Generating for story:', story.substring(0, 50) + '...');
  console.log('🎭 Emotions:', emotions);
  
  try {
    // Smart fallback endings that use the story context
    const preview = story.substring(0, 40);
    const emotionText = emotions && emotions.length > 0 ? emotions.join(', ') : 'adventurous';
    
    const endings = [
      { text: `✨ Continuation 1: "${preview}..." The journey continued with unexpected discoveries. New allies appeared, and the protagonist found the courage to face their greatest fear. The adventure was just beginning.` },
      { text: `✨ Continuation 2: "${preview}..." A mysterious turn of events changed everything. A hidden letter revealed a secret that had been buried for years, leading the protagonist down a path they never expected.` },
      { text: `✨ Continuation 3: "${preview}..." The adventure deepened with new challenges. The protagonist discovered an ancient map that promised to lead them to a forgotten treasure, but danger lurked at every corner.` },
      { text: `✨ Continuation 4: "${preview}..." A powerful choice lay ahead. The protagonist had to decide between duty and desire, knowing that whichever path they chose would change their life forever.` },
      { text: `✨ Continuation 5: "${preview}..." In the end, the truth revealed itself in the most unexpected way. The protagonist realized that the real treasure wasn't gold or glory, but the friends they made along the way.` }
    ];
    
    console.log(`✅ Generated ${endings.length} endings`);
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

// ========== SAVE STORY - FIXED WITH DEBUG ==========
app.post('/api/stories', auth, async (req, res) => {
  try {
    console.log('📝 SAVE STORY REQUEST RECEIVED');
    console.log('📝 User ID:', req.userId);
    console.log('📝 Request body:', req.body);
    
    // Find the user
    const user = await User.findById(req.userId);
    if (!user) {
      console.log('❌ User not found for ID:', req.userId);
      return res.status(404).json({ error: 'User not found' });
    }
    
    console.log('✅ User found:', user.firstName, user.lastName);
    
    // Create the story
    const story = new Story({
      originalStory: req.body.originalStory,
      ending: req.body.ending,
      summary: req.body.ending?.substring(0, 130) + '...' || 'No summary',
      emotions: req.body.emotions || [],
      author: `${user.firstName} ${user.lastName}`,
      authorId: user._id
    });
    
    console.log('📝 Story object created:', story);
    
    // Save to database
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
