export async function GET(){ return new Response(JSON.stringify({ok:true,time:Date.now()}),{headers:{'content-type':'application/json'}}); }
