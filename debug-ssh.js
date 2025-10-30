const socks = require('socksv5');
const { Client } = require('ssh2');

const sshConfig = {
  host:  process.env.SSH_PROXY_HOST,
  port: process.env.SSH_PROXY_PORT,
  username: process.env.SSH_PROXY_USER,
  password: process.env.SSH_PROXY_PASSWORD
};

socks.createServer((info, accept, deny) => {
  // NOTE: you could just use one ssh2 client connection for all forwards, but
  // you could run into server-imposed limits if you have too many forwards open
  // at any given time
  const conn = new Client();
  conn.on('ready', () => {
    conn.forwardOut(info.srcAddr,
                    info.srcPort,
                    info.dstAddr,
                    info.dstPort,
                    (err, stream) => {
      if (err) {
        conn.end();
        return deny();
      }

      const clientSocket = accept(true);
      if (clientSocket) {
        stream.pipe(clientSocket).pipe(stream).on('close', () => {
          conn.end();
        });
      } else {
        conn.end();
      }
    });
  }).on('error', (err) => {
    deny();
  }).connect(sshConfig);
}).listen(5080, 'localhost', () => {
  console.log('SOCKSv5 proxy server started on port 1080');
}).useAuth(socks.auth.None());

// test with cURL:
//   curl -i --socks5 localhost:1080 google.com