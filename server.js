const express = require('express');
const bodyParser = require('body-parser');
const Database = require('better-sqlite3'); // Changed from sqlite3
const path = require('path');
const fs = require('fs');

// Initialize the express app
const app = express();
const port = process.env.PORT || 3000;

// Database setup with error handling
const db = new Database('./cricket.db'); // Simplified connection

console.log('Connected to cricket database');

// Debug information
console.log('Current working directory:', process.cwd());
console.log('Server file directory:', __dirname);

// Verify admin files exist
const adminSetupPath = path.join(__dirname, 'admin-setup.html');
const adminScorePath = path.join(__dirname, 'admin-score.html');

[adminSetupPath, adminScorePath].forEach(filePath => {
  if (!fs.existsSync(filePath)) {
    console.error(`CRITICAL: File not found at ${filePath}`);
  } else {
    console.log(`Found: ${path.basename(filePath)} at ${filePath}`);
  }
});

// Update your table creation code to include winner columns
try {
  db.prepare(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team1 TEXT NOT NULL,
    team2 TEXT NOT NULL,
    total_overs INTEGER NOT NULL,
    toss_winner TEXT NOT NULL,
    toss_decision TEXT NOT NULL,
    current_batting INTEGER NOT NULL,
    batting_phase TEXT NOT NULL DEFAULT 'first',
    target_score INTEGER DEFAULT NULL,
    current_runs INTEGER DEFAULT 0,
    current_wickets INTEGER DEFAULT 0,
    current_overs REAL DEFAULT 0,
    this_over TEXT DEFAULT '',
    winner TEXT DEFAULT NULL,
    win_margin INTEGER DEFAULT NULL,
    win_type TEXT DEFAULT NULL,
    match_status TEXT DEFAULT 'ongoing',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`).run();
  console.log('Matches table ready');
} catch (err) {
  console.error('Table creation error:', err.message);
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// API to get current score
app.get('/api/score', (req, res) => {
  try {
    const row = db.prepare("SELECT * FROM matches ORDER BY id DESC LIMIT 1").get();
    res.json(row || {});
  } catch (err) {
    console.error('Score fetch error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// Admin routes (unchanged)
app.get('/admin', (req, res) => {
  const filePath = path.join(__dirname, 'admin-setup.html');
  console.log(`Serving admin setup: ${filePath}`);
  
  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) {
      console.error('File access error:', err);
      return res.status(404).send('Admin setup page not found');
    }
    res.sendFile(filePath);
  });
});

app.get('/admin/score', (req, res) => {
  const filePath = path.join(__dirname, 'admin-score.html');
  console.log(`Serving score control: ${filePath}`);
  
  fs.access(filePath, fs.constants.R_OK, (err) => {
    if (err) {
      console.error('File access error:', err);
      return res.status(404).send('Admin score page not found');
    }
    res.sendFile(filePath);
  });
});

// Enhanced match setup API
app.post('/api/setup', (req, res) => {
  try {
    const { team1, team2, total_overs, toss_winner, toss_decision, current_batting, batting_phase } = req.body;

    // Validation
    if (!team1 || !team2 || !total_overs || !toss_winner || !toss_decision || !current_batting || !batting_phase) {
      throw new Error('All fields are required');
    }

    const insertMatch = (target_score) => {
      const stmt = db.prepare(
        `INSERT INTO matches (
          team1, team2, total_overs, toss_winner, toss_decision, 
          current_batting, batting_phase, target_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      
      const info = stmt.run(
        team1.toString().trim(),
        team2.toString().trim(),
        parseInt(total_overs),
        toss_winner.toString().trim(),
        toss_decision.toString().trim(),
        parseInt(current_batting),
        batting_phase,
        target_score
      );

      console.log(`Match setup successful with ID: ${info.lastInsertRowid}`);
      res.json({ 
        success: true,
        id: info.lastInsertRowid,
        redirect: '/admin/score'
      });
    };

    if (batting_phase === 'chase') {
      const row = db.prepare("SELECT current_runs FROM matches ORDER BY id DESC LIMIT 1").get();
      if (!row) {
        return res.status(400).json({ 
          success: false,
          error: "No previous innings found to chase" 
        });
      }
      insertMatch(row.current_runs + 1);
    } else {
      insertMatch(null);
    }
  } catch (error) {
    console.error('Setup error:', error);
    res.status(400).json({
      success: false,
      error: error.message,
      received: req.body
    });
  }
});

// Score update API
app.post('/api/update-score', (req, res) => {
  try {
    const { action, customRun, nbAdditionalRuns, displayText } = req.body;

    if (!action) {
      throw new Error('Action is required');
    }

    const match = db.prepare("SELECT * FROM matches ORDER BY id DESC LIMIT 1").get();
    if (!match) throw new Error("Match not initialized");

    let { current_runs, current_wickets, current_overs, this_over } = match;
    let overHistory = this_over ? this_over.split(',') : [];

    // Process action
    const result = processScoreAction(
      action,
      customRun,
      current_runs,
      current_wickets,
      current_overs,
      overHistory,
      nbAdditionalRuns,
      displayText
    );

    const info = db.prepare(
      `UPDATE matches SET 
        current_runs = ?,
        current_wickets = ?,
        current_overs = ?,
        this_over = ?,
        last_updated = CURRENT_TIMESTAMP
      WHERE id = ?`
    ).run(
      result.runs,
      result.wickets,
      result.overs,
      result.overHistory.join(','),
      match.id
    );

    res.json({ 
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Score update failed:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

// (Keep your existing processScoreAction and updateOvers functions exactly the same)

app.post('/api/set-winner', (req, res) => {
  try {
    const { winningTeam, winMargin, winType } = req.body;
    
    if (!winningTeam || !winMargin || !winType) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }
    
    if (isNaN(winMargin) || winMargin < 1) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid win margin' 
      });
    }

    const info = db.prepare(
      `UPDATE matches SET 
        winner = ?,
        win_margin = ?,
        win_type = ?,
        match_status = 'completed'
      WHERE id = (SELECT id FROM matches ORDER BY id DESC LIMIT 1)`
    ).run(
      winningTeam,
      parseInt(winMargin),
      winType
    );
    
    if (info.changes === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'No match found to update' 
      });
    }
    
    res.json({ 
      success: true,
      changes: info.changes
    });
  } catch (error) {
    console.error('Unexpected error in set-winner:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`\nServer running on port ${port}`);
  console.log(`Admin Setup: http://localhost:${port}/admin`);
  console.log(`Score Control: http://localhost:${port}/admin/score`);
  console.log(`Public View: http://localhost:${port}\n`);
});