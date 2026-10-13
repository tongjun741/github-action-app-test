// 读取 LocalStorage
const value = localStorage.getItem('szdamai_localStorage_key');
console.log(value); // 输出 'value'
// 读取 Cookie
const cookies = document.cookie;
console.log(cookies);
// 打开或创建 IndexedDB 数据库
const dbName = "szdamai_dbName";
const request = indexedDB.open(dbName, 2);
request.onerror = (event) => {
    console.error(event);
    // 错误处理
};
request.onsuccess = (event) => {
    console.log('打开数据库成功');
    const db = event.target.result;
    console.log(db);

    if (db) {
        try{
        let ob = db
            .transaction("szdamai_customers")
            .objectStore("szdamai_customers")
            .get("new_customre_name").onsuccess = (event) => {
                console.log(event);
                console.log(`SSN 444-44-4444 对应的名字是 ${event.target.result.extInfo}`);
            }
            ob.onerror = (event) => {
                console.error(event);
                // 错误处理
            };
        }catch(e){
            console.error("读取数据库失败", e);
        }
    } else {
        console.log('读取数据库失败');
    }
};
