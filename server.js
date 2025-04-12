const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const app = express();
const port = process.env.PORT || 3000;

// Database setup with error handling
const db = new sqlite3.Database('./cricket.db', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to cricket database');
  }
});

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

// Create tables with error handling
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team1 TEXT NOT NULL,
    team2 TEXT NOT NULL,
    total_overs INTEGER NOT NULL,
    toss_winner TEXT NOT NULL,
    toss_decision TEXT NOT NULL,
    current_batting INTEGER NOT NULL,
    current_runs INTEGER DEFAULT 0,
    current_wickets INTEGER DEFAULT 0,
    current_overs REAL DEFAULT 0,
    this_over TEXT DEFAULT '',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error('Table creation error:', err.message);
    } else {
      console.log('Matches table ready');
    }
  });
});

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// API to get current score
app.get('/api/score', (req, res) => {
  db.get("SELECT * FROM matches ORDER BY id DESC LIMIT 1", (err, row) => {
    if (err) {
      console.error('Score fetch error:', err);
      return res.status(500).json({ 
        success: false,
        error: err.message 
      });
    }
    res.json(row || {});
  });
});

// Admin routes
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
    const { team1, team2, total_overs, toss_winner, toss_decision, current_batting } = req.body;

    // Validation
    if (!team1 || !team2 || !total_overs || !toss_winner || !toss_decision || !current_batting) {
      throw new Error('All fields are required');
    }

    console.log('Setting up match with:', {
      team1, team2, 
      total_overs: parseInt(total_overs),
      toss_winner, 
      toss_decision,
      current_batting: parseInt(current_batting)
    });

    db.run(
      `INSERT INTO matches (
        team1, team2, total_overs, toss_winner, toss_decision, current_batting
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        team1.toString().trim(),
        team2.toString().trim(),
        parseInt(total_overs),
        toss_winner.toString().trim(),
        toss_decision.toString().trim(),
        parseInt(current_batting)
      ],
      function(err) {
        if (err) {
          console.error('Database insert error:', err);
          return res.status(500).json({ 
            success: false,
            error: 'Failed to setup match',
            details: err.message
          });
        }

        console.log(`Match setup successful with ID: ${this.lastID}`);
        res.json({ 
          success: true,
          id: this.lastID,
          redirect: '/admin/score'
        });
      }
    );
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
    const { action, customRun } = req.body;

    if (!action) {
      throw new Error('Action is required');
    }

    db.get("SELECT * FROM matches ORDER BY id DESC LIMIT 1", (err, match) => {
      if (err) throw err;
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
        overHistory
      );

      db.run(
        `UPDATE matches SET 
          current_runs = ?,
          current_wickets = ?,
          current_overs = ?,
          this_over = ?,
          last_updated = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
          result.runs,
          result.wickets,
          result.overs,
          result.overHistory.join(','),
          match.id
        ],
        function(err) {
          if (err) {
            console.error('Score update error:', err);
            return res.status(500).json({ 
              success: false,
              error: err.message 
            });
          }
          res.json({ 
            success: true,
            ...result
          });
        }
      );
    });
  } catch (error) {
    console.error('Score update failed:', error);
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

function processScoreAction(action, customRun, runs, wickets, overs, overHistory) {
  // Process the action
  switch (action) {
    case '0': case '1': case '2': case '3': case '4': case '6':
      runs += parseInt(action);
      overs = updateOvers(overs);
      overHistory.push(action);
      break;
    case 'wicket':
      wickets += 1;
      overs = updateOvers(overs);
      overHistory.push('W');
      break;
    case 'WD':
      runs += 1;
      overHistory.push('WD');
      break;
    case 'NB':
      runs += 1;
      overHistory.push('NB');
      break;
    case 'custom':
      if (!customRun || isNaN(customRun)) throw new Error('Invalid custom run value');
      runs += parseInt(customRun);
      overs = updateOvers(overs);
      overHistory.push(customRun);
      break;
    default:
      throw new Error('Invalid action');
  }

  // Keep only last 6 valid balls
  const validBalls = overHistory.filter(ball => !['WD', 'NB'].includes(ball));
  if (validBalls.length > 6) {
    overHistory = overHistory.slice(-8); // Keep some extra for WD/NB
  }

  return {
    runs,
    wickets,
    overs,
    overHistory,
    thisOver: overHistory.join(',')
  };
}

function updateOvers(currentOvers) {
  const balls = Math.round((currentOvers % 1) * 10);
  const completedOvers = Math.floor(currentOvers);
  
  return balls >= 5 ? completedOvers + 1 : completedOvers + (balls + 1) / 10;
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.listen(port, () => {
  console.log(`\nServer running on port ${port}`);
  console.log(`Admin Setup: http://localhost:${port}/admin`);
  console.log(`Score Control: http://localhost:${port}/admin/score`);
  console.log(`Public View: http://localhost:${port}\n`);
});