const http = require('http');

// http://ds.0728123.xyz:65080/log_channel2
const options = {
  hostname: 'ds.0728123.xyz',
  port: '65080',
  path: '/log_channel2?text=newline212',
  method: 'GET'
};

const req = http.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log(responseData);
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.end();
