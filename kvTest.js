
const { saveResult, showResultTable } = require('./tests/include/tools');

async function main(){
    let s = await showResultTable(true);
    console.log(s);
    let newTime = new Date().getTime();
    console.log(newTime);
    await saveResult(true, 'w', 'dd'+newTime);
    s = await showResultTable(true);
    console.log(s);
}
main();