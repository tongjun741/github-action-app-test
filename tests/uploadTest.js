// 

const { uploadFile } = require("./include/tools");

 function main() {
    const filePath = './tests/include/app-screenshot.png';
   return uploadFile(filePath).then(url => {
       console.log('Uploaded file URL:', url);
   }).catch(err => {
       console.error('Upload failed:', err);
   });
};


main();