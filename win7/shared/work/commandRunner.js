const { spawn } = require('child_process');

function createCommandExecutor({
  sendHttpLog,
  envVars = {},
  output = console.log,
  errorOutput = console.error
}) {
  return async function executeCommand(command, args = []) {
    await sendHttpLog(`Starting command: ${command} ${JSON.stringify({ args })}`);

    return new Promise((resolve, reject) => {
      const childProcess = spawn(command, args, {
        env: { ...process.env, ...envVars },
        shell: false
      });
      let stdout = '';
      let stderr = '';
      let spawnError;

      childProcess.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        output(text);
      });

      childProcess.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        errorOutput(text);
      });

      childProcess.on('error', (error) => {
        spawnError = error;
      });

      childProcess.on('close', (code) => {
        output(`Command finished: ${command} ${JSON.stringify({ args })}; exit code: ${code}`);

        if (spawnError) {
          reject(spawnError);
        } else if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(
            `Command failed: ${command} ${JSON.stringify({ args })}; exit code: ${code}\n${stderr}`
          ));
        }
      });
    });
  };
}

module.exports = {
  createCommandExecutor
};
