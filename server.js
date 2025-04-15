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
    
    if (!match) {
      return res.json({});
    }

    // Calculate current over balls for response
    const overHistory = match.thisOver ? match.thisOver.split(',') : [];
    let currentOverBalls = [];
    let legalBallsCount = 0;
    
    for (let i = overHistory.length - 1; i >= 0; i--) {
      const ball = overHistory[i];
      currentOverBalls.unshift(ball);
      
      if (!['WD', 'NB'].includes(ball) && !ball.startsWith('NB+')) {
        legalBallsCount++;
        if (legalBallsCount >= 6) break;
      }
    }

    res.json({
      ...match.toJSON(),
      currentOverBalls: currentOverBalls.join(',')
    });
    
  } catch (err) {
    console.error('Score fetch error:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// Admin routes
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-setup.html'));
});

app.get('/admin/score', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-score.html'));
});

// Match setup API
app.post('/api/setup', async (req, res) => {
  try {
    const { team1, team2, total_overs, toss_winner, toss_decision, current_batting, batting_phase } = req.body;

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

        let runsToAdd = 0;
        let wicketToAdd = 0;
        let isLegalBall = true;
        let overEntry = '';

        switch (action.toString().toLowerCase()) {
            case '0':
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
        match.currentRuns += runsToAdd;
        match.currentWickets += wicketToAdd;

        // Get full over history (includes extras)
        let overHistory = match.thisOver ? match.thisOver.split(',') : [];

        // Add current ball to history
        overHistory.push(overEntry);

        // Filter to only legal balls (exclude WD, NB)
        const legalBalls = overHistory.filter(ball => 
            !['WD'].includes(ball) &&
            !ball.startsWith('NB')
        );

        // Calculate overs
        const totalLegalBalls = legalBalls.length;
        const completedOvers = Math.floor(totalLegalBalls / 6);
        const ballsInCurrentOver = totalLegalBalls % 6;
        const currentOversDisplay = `${completedOvers}.${ballsInCurrentOver}`;

        // Prepare "this over" display: get last X legal balls in current over
        const lastOverLegalBalls = legalBalls.slice(-ballsInCurrentOver);

        match.currentOvers = parseFloat(currentOversDisplay);
        match.thisOver = overHistory.join(',');
        await match.save();

        res.json({
            success: true,
            currentRuns: match.currentRuns,
            currentWickets: match.currentWickets,
            currentOvers: currentOversDisplay,
            totalOvers: match.totalOvers,
            currentOverBalls: lastOverLegalBalls.join(','),
            team1: match.team1,
            team2: match.team2,
            tossWinner: match.tossWinner,
            tossDecision: match.tossDecision,
            battingPhase: match.battingPhase,
            targetScore: match.targetScore,
            currentBatting: match.currentBatting,
            thisOver: match.thisOver
        });

    } catch (error) {
        console.error('Score update failed:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});


  // Undo Endpoint 
  app.post('/api/undo-action', async (req, res) => {
    try {
      const match = await Match.findOne({
        order: [['id', 'DESC']]
      });
      
      if (!match) throw new Error("Match not initialized");
      if (match.matchStatus !== 'ongoing') throw new Error("Cannot undo completed match");
  
      const overHistory = match.thisOver ? match.thisOver.split(',') : [];
      if (overHistory.length === 0) throw new Error("Nothing to undo");
  
      // Get the last action
      const lastAction = overHistory.pop();
      
      // Calculate how to reverse the last action
      let runsToSubtract = 0;
      let wicketToSubtract = 0;
      
      switch (lastAction) {
        case 'W':
          wicketToSubtract = 1;
          break;
        case 'WD':
          runsToSubtract = 1;
          break;
        case 'NB':
        case lastAction.startsWith('NB+') && lastAction:
          const nbRuns = lastAction.includes('+') ? parseInt(lastAction.split('+')[1]) || 0 : 0;
          runsToSubtract = 1 + nbRuns;
          break;
        default:
          // Regular run
          runsToSubtract = parseInt(lastAction) || 0;
      }
  
      // Update match data
      match.currentRuns = Math.max(0, match.currentRuns - runsToSubtract);
      match.currentWickets = Math.max(0, match.currentWickets - wicketToSubtract);
      match.thisOver = overHistory.join(',');
  
      // Recalculate overs
      const legalBalls = overHistory.filter(ball => 
        !['WD', 'NB'].includes(ball) && !ball.startsWith('NB+')
      ).length;
      const ballsInOver = legalBalls % 6;
      const completedOvers = Math.floor(legalBalls / 6);
      match.currentOvers = completedOvers + (ballsInOver * 0.1);
  
      await match.save();
  
      // Get balls from current incomplete over only
      const currentOverBallsCount = Math.floor((match.currentOvers % 1) * 10);
      const ballsInCurrentOver = overHistory.slice(-currentOverBallsCount);
  
      res.json({ 
        success: true,
        currentRuns: match.currentRuns,
        currentWickets: match.currentWickets,
        currentOvers: match.currentOvers.toFixed(1),
        totalOvers: match.totalOvers,
        currentOverBalls: ballsInCurrentOver.join(','),
        team1: match.team1,
        team2: match.team2,
        tossWinner: match.tossWinner,
        tossDecision: match.tossDecision,
        battingPhase: match.battingPhase,
        targetScore: match.targetScore,
        currentBatting: match.currentBatting,
        thisOver: overHistory.join(',')
      });
  
    } catch (error) {
      console.error('Undo action failed:', error);
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

// Start server
app.listen(port, () => {
  console.log(`\nServer running on port ${port}`);
  console.log(`Admin Setup: http://localhost:${port}/admin`);
  console.log(`Score Control: http://localhost:${port}/admin/score`);
  console.log(`Public View: http://localhost:${port}\n`);
});