const express = require('express');
const bodyParser = require('body-parser');
const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const fs = require('fs');

// Initialize the express app
const app = express();
const port = process.env.PORT || 3000;

// Database setup with PostgreSQL
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  },
  logging: false
});

// Define Match model
const Match = sequelize.define('Match', {
  team1: {
    type: DataTypes.STRING,
    allowNull: false
  },
  team2: {
    type: DataTypes.STRING,
    allowNull: false
  },
  totalOvers: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  tossWinner: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tossDecision: {
    type: DataTypes.STRING,
    allowNull: false
  },
  currentBatting: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  battingPhase: {
    type: DataTypes.STRING,
    defaultValue: 'first'
  },
  targetScore: {
    type: DataTypes.INTEGER
  },
  currentRuns: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  currentWickets: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  currentOvers: {
    type: DataTypes.FLOAT,
    defaultValue: 0.0
  },
  thisOver: {
    type: DataTypes.STRING,
    defaultValue: ''
  },
  winner: {
    type: DataTypes.STRING
  },
  winMargin: {
    type: DataTypes.INTEGER
  },
  winType: {
    type: DataTypes.STRING
  },
  matchStatus: {
    type: DataTypes.STRING,
    defaultValue: 'ongoing'
  }
}, {
  tableName: 'matches',
  timestamps: true,
  updatedAt: 'last_updated',
  createdAt: false
});

// Initialize database
async function initializeDB() {
  try {
    await sequelize.authenticate();
    await Match.sync();
    console.log('Database connected and synced');
  } catch (error) {
    console.error('Database connection error:', error);
  }
}
initializeDB();

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

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// API to get current score
app.get('/api/score', async (req, res) => {
  try {
    const match = await Match.findOne({
      order: [['id', 'DESC']]
    });
    res.json(match || {});
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
  res.sendFile(filePath);
});

app.get('/admin/score', (req, res) => {
  const filePath = path.join(__dirname, 'admin-score.html');
  res.sendFile(filePath);
});

// Enhanced match setup API
app.post('/api/setup', async (req, res) => {
  try {
    const { team1, team2, total_overs, toss_winner, toss_decision, current_batting, batting_phase } = req.body;

    // Validation
    if (!team1 || !team2 || !total_overs || !toss_winner || !toss_decision || !current_batting || !batting_phase) {
      throw new Error('All fields are required');
    }

    if (batting_phase === 'chase') {
      const previousMatch = await Match.findOne({
        order: [['id', 'DESC']]
      });
      
      if (!previousMatch) {
        return res.status(400).json({ 
          success: false,
          error: "No previous innings found to chase" 
        });
      }

      const match = await Match.create({
        team1,
        team2,
        totalOvers: total_overs,
        tossWinner: toss_winner,
        tossDecision: toss_decision,
        currentBatting: current_batting,
        battingPhase: batting_phase,
        targetScore: previousMatch.currentRuns + 1
      });

      res.json({ 
        success: true,
        id: match.id,
        redirect: '/admin/score'
      });
    } else {
      const match = await Match.create({
        team1,
        team2,
        totalOvers: total_overs,
        tossWinner: toss_winner,
        tossDecision: toss_decision,
        currentBatting: current_batting,
        battingPhase: batting_phase
      });

      res.json({ 
        success: true,
        id: match.id,
        redirect: '/admin/score'
      });
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
// In your score update API endpoint (app.post('/api/update-score'))
// Update your /api/update-score endpoint in server.js
app.post('/api/update-score', async (req, res) => {
    try {
      const { action, customRun, nbAdditionalRuns, displayText } = req.body;
  
      if (!action) {
        throw new Error('Action is required');
      }
  
      const match = await Match.findOne({
        order: [['id', 'DESC']]
      });
      
      if (!match) throw new Error("Match not initialized");
  
      let { currentRuns, currentWickets, currentOvers, thisOver, totalOvers } = match;
      let overHistory = thisOver ? thisOver.split(',') : [];
      
      // Process the action
      let runsToAdd = 0;
      let wicketToAdd = 0;
      let isLegalBall = true;
      let overEntry = '';
  
      switch (action.toString().toLowerCase()) { // Make case insensitive
        case '0':
          overEntry = '0';
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '6':
          runsToAdd = parseInt(action);
          overEntry = action;
          break;
        case 'w':
        case 'wicket':
          wicketToAdd = 1;
          overEntry = 'W';
          break;
        case 'wd':
          runsToAdd = 1;
          overEntry = 'WD';
          isLegalBall = false;
          break;
        case 'nb':
          runsToAdd = 1 + (parseInt(nbAdditionalRuns) || 0);
          overEntry = displayText || `NB${nbAdditionalRuns ? `+${nbAdditionalRuns}` : ''}`;
          isLegalBall = false;
          break;
        case 'custom':
          if (!customRun || isNaN(customRun)) {
            throw new Error('Invalid custom run value');
          }
          runsToAdd = parseInt(customRun);
          overEntry = customRun;
          break;
        default:
          throw new Error('Invalid action');
      }
  
      // Update match data
      currentRuns += runsToAdd;
      currentWickets += wicketToAdd;
  
      // Calculate legal balls count for over progression
      const legalBallsCount = overHistory.filter(ball => 
        !['WD', 'NB'].includes(ball) && !ball.startsWith('NB+')
      ).length;
  
      // Update currentOvers display (e.g., 4.3 means 4 overs and 3 balls)
      const completedOvers = Math.floor(legalBallsCount / 6);
      const ballsInCurrentOver = legalBallsCount % 6;
      
      // Only update currentOvers if it's a legal ball
      if (isLegalBall) {
        currentOvers = completedOvers + (ballsInCurrentOver * 0.1);
      }
  
      // Update over history
      overHistory.push(overEntry);
      
      // Get only the current over's balls (last 6 entries)
      const currentOverBalls = overHistory.slice(-6);
  
      // Save updated match
      await match.update({
        currentRuns,
        currentWickets,
        currentOvers: parseFloat(currentOvers.toFixed(1)), // Ensure single decimal place
        thisOver: overHistory.join(',')
      });
  
      res.json({ 
        success: true,
        currentRuns,
        currentWickets,
        currentOvers: currentOvers.toFixed(1), // Format as "overs.balls"
        totalOvers,
        thisOver: currentOverBalls.join(','), // Only current over's balls
        fullOverHistory: overHistory.join(','),
        message: 'Score updated successfully'
      });
  
    } catch (error) {
      console.error('Score update failed:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  });
  
// Set winner API
app.post('/api/set-winner', async (req, res) => {
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

    const match = await Match.findOne({
      order: [['id', 'DESC']]
    });
    
    if (!match) {
      return res.status(404).json({ 
        success: false, 
        error: 'No match found to update' 
      });
    }

    await match.update({
      winner: winningTeam,
      winMargin: parseInt(winMargin),
      winType: winType,
      matchStatus: 'completed'
    });
    
    res.json({ 
      success: true,
      changes: 1
    });
  } catch (error) {
    console.error('Unexpected error in set-winner:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Keep your existing helper functions
function processScoreAction(action, customRun, runs, wickets, overs, overHistory, nbAdditionalRuns, displayText) {
  // ... (keep your existing implementation)
}

function updateOvers(currentOvers) {
  // ... (keep your existing implementation)
}

// Start server
app.listen(port, () => {
  console.log(`\nServer running on port ${port}`);
  console.log(`Admin Setup: http://localhost:${port}/admin`);
  console.log(`Score Control: http://localhost:${port}/admin/score`);
  console.log(`Public View: http://localhost:${port}\n`);
});