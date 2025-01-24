const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const VENV_PATH = path.join(__dirname, '..', 'venv');
const REQUIREMENTS_PATH = path.join(__dirname, '..', 'requirements.txt');

function getPythonCommand() {
  // Try python3 first, then fall back to python
  try {
    spawnSync('python3', ['--version']);
    return 'python3';
  } catch (err) {
    try {
      spawnSync('python', ['--version']);
      return 'python';
    } catch (err) {
      throw new Error('Python is not installed');
    }
  }
}

function getVenvPip() {
  const isWindows = process.platform === 'win32';
  return path.join(VENV_PATH, isWindows ? 'Scripts' : 'bin', isWindows ? 'pip.exe' : 'pip');
}

function getVenvPython() {
  const isWindows = process.platform === 'win32';
  return path.join(VENV_PATH, isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python');
}

async function setupVenv() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(VENV_PATH)) {
      console.log('Virtual environment already exists');
      resolve();
      return;
    }

    console.log('Creating virtual environment...');
    const pythonCmd = getPythonCommand();
    const venv = spawn(pythonCmd, ['-m', 'venv', VENV_PATH]);

    venv.stdout.on('data', (data) => console.log(data.toString()));
    venv.stderr.on('data', (data) => console.error(data.toString()));

    venv.on('close', (code) => {
      if (code === 0) {
        console.log('Virtual environment created successfully');
        resolve();
      } else {
        reject(new Error(`Failed to create virtual environment (exit code: ${code})`));
      }
    });
  });
}

async function installRequirements() {
  return new Promise((resolve, reject) => {
    console.log('Installing Python packages...');
    const pip = spawn(getVenvPip(), ['install', '-r', REQUIREMENTS_PATH]);

    pip.stdout.on('data', (data) => console.log(data.toString()));
    pip.stderr.on('data', (data) => console.error(data.toString()));

    pip.on('close', (code) => {
      if (code === 0) {
        console.log('Python packages installed successfully');
        resolve();
      } else {
        reject(new Error(`Failed to install packages (exit code: ${code})`));
      }
    });
  });
}

async function setup() {
  try {
    await setupVenv();
    await installRequirements();
    console.log('Setup completed successfully');
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  }
}

// Export for use in main process
module.exports = {
  setup,
  getVenvPython,
  VENV_PATH
}; 