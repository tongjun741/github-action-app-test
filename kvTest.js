const axios = require('axios');

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

async function getKey(key) {
    try {
        const response = await axios.get(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`, {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'application/json',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching key:', error);
        throw error;
    }
}

async function putKey(key, value) {
    try {
        const response = await axios.put(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${key}`, value, {
            headers: {
                'Authorization': `Bearer ${apiToken}`,
                'Content-Type': 'text/plain',
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error putting key:', error);
        throw error;
    }
}

// 示例用法
(async () => {
    try {
        await putKey('my-key', 'my-value');
        const value = await getKey('my-key');
        console.log(value); // 输出: my-value
    } catch (error) {
        console.error('Error in example usage:', error);
    }
})();
