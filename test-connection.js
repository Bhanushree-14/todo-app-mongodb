const { MongoClient } = require('mongodb');

const uri = "mongodb+srv://ganavihv2005_db_user:Ganavi%402005@cluster0.dewmqys.mongodb.net/?retryWrites=true&w=majority";

async function testConnection() {
  const client = new MongoClient(uri);
  try {
    await client.connect();
    console.log("✅ Connected successfully!");
    const databases = await client.db().admin().listDatabases();
    console.log("Databases:", databases.databases.map(db => db.name));
  } catch (err) {
    console.error("❌ Connection failed:", err.message);
  } finally {
    await client.close();
  }
}

testConnection();