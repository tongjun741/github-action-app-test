// 写入 LocalStorage
localStorage.setItem('szdamai_localStorage_key', 'szdamai_localStorage_value');
// 写入 Cookie
document.cookie = "szdamai_Cookie_key=szdamai_Cookie_value; expires=Fri, 31 Dec 9999 23:59:59 GMT; path=/";
// 打开或创建 IndexedDB 数据库
const dbName = "szdamai_dbName";
const request = indexedDB.open(dbName, 2);
request.onerror = (event) => {
    console.log("indexedDB.open 失败", event);
    // 错误处理
};

request.onupgradeneeded = (event) => {
  const db = event.target.result;
  console.log('onupgradeneeded event triggered');

  // 创建对象存储（表），如果它还不存在
  if (!db.objectStoreNames.contains('szdamai_customers')) {
    db.createObjectStore('szdamai_customers', { keyPath: 'name' });
  }
};

request.onsuccess = (event) => {
  const db = event.target.result;
  console.log('Database opened successfully');

  // 开始事务以写入数据
  const transaction = db.transaction('szdamai_customers', 'readwrite');
  const objectStore = transaction.objectStore('szdamai_customers');

  // 添加数据到对象存储中
  const addRequest = objectStore.add({
            "name": "new_customre_name",
            "extInfo": "xdfd"
        });

  addRequest.onsuccess = () => {
    console.log('Data added to the object store');
  };

  addRequest.onerror = (event) => {
    console.error('Error adding data:', event.target.error);
  };

  // 处理事务完成
  transaction.oncomplete = () => {
    console.log('Transaction completed successfully');
  };

  transaction.onerror = (event) => {
    console.error('Transaction error:', event.target.error);
  }
};
