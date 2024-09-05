const fetch = require('node-fetch');

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

async function getKey(key) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`, {
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
    });
    return response.text();
}

async function putKey(key, value) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'text/plain',
        },
        body: value,
    });
    return response.text();
}

// 示例用法
(async () => {
    await putKey('my-key', 'my-value');
    const value = await getKey('my-key');
    console.log(value); // 输出: my-value
})();
