// API/admin.js
const fs = require("fs");
const path = require("path");

module.exports = function (app) {
  // Admin: Start auto-refresh
  app.post("/api/admin/start", (req, res) => {
    try {
      const server = require("../server.js");
      
      if (server.serverState.isRunning) {
        return res.json({
          success: false,
          message: "Auto-refresh is already running"
        });
      }
      
      server.startAutoRefresh();
      
      res.json({
        success: true,
        message: "Auto-refresh started",
        mode: server.serverState.mode,
        next_refresh: server.serverState.nextRefresh,
        instrument: server.CONFIG.INSTRUMENT_KEY,
        interval: server.CONFIG.REFRESH_INTERVAL / 1000
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error starting auto-refresh",
        error: error.message
      });
    }
  });

  // Admin: Stop auto-refresh
  app.post("/api/admin/stop", (req, res) => {
    try {
      const server = require("../server.js");
      
      if (!server.serverState.isRunning) {
        return res.json({
          success: false,
          message: "Auto-refresh is not running"
        });
      }
      
      server.stopAutoRefresh();
      
      res.json({
        success: true,
        message: "Auto-refresh stopped",
        mode: server.serverState.mode,
        last_update: server.serverState.lastUpdateIST
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error stopping auto-refresh",
        error: error.message
      });
    }
  });

  // Admin: Update access token
  app.post("/api/admin/token", (req, res) => {
    try {
      const { token, save_to_env } = req.body;
      
      if (!token) {
        return res.status(400).json({
          success: false,
          message: "Token is required"
        });
      }
      
      // Update server config
      const server = require("../server.js");
      server.CONFIG.ACCESS_TOKEN = token;
      
      // Save to .env file if requested
      if (save_to_env) {
        const envPath = path.join(__dirname, "..", ".env");
        let envContent = "";
        
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf8");
          
          // Update or add UPSTOX_ACCESS_TOKEN
          if (envContent.includes("UPSTOX_ACCESS_TOKEN=")) {
            envContent = envContent.replace(
              /UPSTOX_ACCESS_TOKEN=.*/,
              `UPSTOX_ACCESS_TOKEN=${token}`
            );
          } else {
            envContent += `\nUPSTOX_ACCESS_TOKEN=${token}`;
          }
        } else {
          envContent = `UPSTOX_ACCESS_TOKEN=${token}`;
        }
        
        fs.writeFileSync(envPath, envContent);
      }
      
      server.log(`Access token updated${save_to_env ? ' and saved to .env' : ''}`);
      
      res.json({
        success: true,
        message: `Access token updated${save_to_env ? ' and saved to .env' : ''}`,
        token_saved: save_to_env || false
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error updating token",
        error: error.message
      });
    }
  });

  // Admin: Set schedule
  app.post("/api/admin/schedule", (req, res) => {
    try {
      const { start_time, stop_time, save_to_env } = req.body;
      
      // Validate times (HH:MM format)
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      
      if (start_time && !timeRegex.test(start_time)) {
        return res.status(400).json({
          success: false,
          message: "Invalid start time format. Use HH:MM (24-hour)"
        });
      }
      
      if (stop_time && !timeRegex.test(stop_time)) {
        return res.status(400).json({
          success: false,
          message: "Invalid stop time format. Use HH:MM (24-hour)"
        });
      }
      
      // Update server config
      const server = require("../server.js");
      if (start_time) server.CONFIG.AUTO_SCHEDULE_START = start_time;
      if (stop_time) server.CONFIG.AUTO_SCHEDULE_STOP = stop_time;
      
      // Save to .env file if requested
      if (save_to_env && (start_time || stop_time)) {
        const envPath = path.join(__dirname, "..", ".env");
        let envContent = "";
        
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, "utf8");
          
          // Update or add schedule settings
          if (start_time) {
            if (envContent.includes("AUTO_SCHEDULE_START=")) {
              envContent = envContent.replace(
                /AUTO_SCHEDULE_START=.*/,
                `AUTO_SCHEDULE_START=${start_time}`
              );
            } else {
              envContent += `\nAUTO_SCHEDULE_START=${start_time}`;
            }
          }
          
          if (stop_time) {
            if (envContent.includes("AUTO_SCHEDULE_STOP=")) {
              envContent = envContent.replace(
                /AUTO_SCHEDULE_STOP=.*/,
                `AUTO_SCHEDULE_STOP=${stop_time}`
              );
            } else {
              envContent += `\nAUTO_SCHEDULE_STOP=${stop_time}`;
            }
          }
        } else {
          envContent = "";
          if (start_time) envContent += `AUTO_SCHEDULE_START=${start_time}`;
          if (stop_time) envContent += `\nAUTO_SCHEDULE_STOP=${stop_time}`;
        }
        
        fs.writeFileSync(envPath, envContent);
      }
      
      const scheduleMessage = `Schedule set to: ${start_time || 'Not set'} to ${stop_time || 'Not set'}`;
      server.log(`Schedule updated: ${scheduleMessage}`);
      
      res.json({
        success: true,
        message: scheduleMessage,
        schedule: {
          start: server.CONFIG.AUTO_SCHEDULE_START,
          stop: server.CONFIG.AUTO_SCHEDULE_STOP
        },
        saved_to_env: save_to_env || false
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error setting schedule",
        error: error.message
      });
    }
  });

  // Admin: Get all settings
  app.get("/api/admin/settings", (req, res) => {
    try {
      const server = require("../server.js");
      const envPath = path.join(__dirname, "..", ".env");
      
      let envExists = false;
      let envSettings = {};
      
      if (fs.existsSync(envPath)) {
        envExists = true;
        const envContent = fs.readFileSync(envPath, "utf8");
        const lines = envContent.split("\n");
        
        lines.forEach(line => {
          if (line.trim() && !line.startsWith("#")) {
            const [key, ...valueParts] = line.split("=");
            if (key && valueParts.length > 0) {
              envSettings[key.trim()] = valueParts.join("=").trim();
            }
          }
        });
      }
      
      res.json({
        success: true,
        current_settings: {
          instrument: server.CONFIG.INSTRUMENT_KEY,
          instrument_name: server.getInstrumentName(server.CONFIG.INSTRUMENT_KEY),
          port: server.CONFIG.PORT,
          refresh_interval: server.CONFIG.REFRESH_INTERVAL / 1000,
          auto_start: server.CONFIG.AUTO_START,
          auto_schedule_start: server.CONFIG.AUTO_SCHEDULE_START,
          auto_schedule_stop: server.CONFIG.AUTO_SCHEDULE_STOP,
          has_token: !!server.CONFIG.ACCESS_TOKEN,
          token_length: server.CONFIG.ACCESS_TOKEN ? server.CONFIG.ACCESS_TOKEN.length : 0
        },
        environment_file: {
          exists: envExists,
          path: envPath,
          settings: envSettings
        },
        server_state: {
          is_running: server.serverState.isRunning,
          mode: server.serverState.mode,
          last_update: server.serverState.lastUpdateIST,
          total_updates: server.serverState.totalUpdates
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: "Error getting settings",
        error: error.message
      });
    }
  });

  // Admin: Clear logs
  app.post("/api/admin/clear-logs", (req, res) => {
    try {
      const server = require("../server.js");

      // Clear in-memory buffer
      if (server.logBuffer) server.logBuffer.splice(0, server.logBuffer.length);

      // Clear log file if exists
      if (fs.existsSync(server.CONFIG.LOG_FILE)) {
        fs.writeFileSync(server.CONFIG.LOG_FILE, "");
      }

      server.log("Logs cleared by admin");
      res.json({ success: true, message: "Logs cleared successfully" });
    } catch (error) {
      res.status(500).json({ success: false, message: "Error clearing logs", error: error.message });
    }
  });

  // Admin: Get recent logs — in-memory buffer first, PM2 log file as fallback
  app.get("/api/admin/logs", (req, res) => {
    try {
      const server = require("../server.js");
      const lines  = parseInt(req.query.lines) || 200;

      // 1. Serve from in-memory ring buffer (captures ALL console.log output)
      if (server.logBuffer && server.logBuffer.length > 0) {
        const recent = server.logBuffer.slice(-lines);
        return res.json({ success: true, logs: recent, total_lines: server.logBuffer.length, source: 'buffer' });
      }

      // 2. Fallback: read PM2 stdout log file
      const os = require('os');
      const pm2Log = require('path').join(os.homedir(), '.pm2', 'logs', 'soc-out.log');
      const pm2Err = require('path').join(os.homedir(), '.pm2', 'logs', 'soc-error.log');

      let allLines = [];
      for (const f of [pm2Log, pm2Err]) {
        if (fs.existsSync(f)) {
          const content = fs.readFileSync(f, 'utf8');
          allLines = allLines.concat(content.split('\n').filter(l => l.trim()));
        }
      }

      if (allLines.length > 0) {
        return res.json({ success: true, logs: allLines.slice(-lines), total_lines: allLines.length, source: 'pm2' });
      }

      res.json({ success: true, logs: [], total_lines: 0, source: 'none' });
    } catch (error) {
      res.status(500).json({ success: false, message: "Error reading logs", error: error.message });
    }
  });
};