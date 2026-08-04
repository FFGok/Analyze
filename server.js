require('dotenv').config();
const express=require('express');
const path=require('path');
const multer=require('multer');
const helmet=require('helmet');
const rateLimit=require('express-rate-limit');
const OpenAI=require('openai');

const app=express();
const PORT=process.env.PORT||3000;
const MODEL=process.env.OPENAI_MODEL||'gpt-5';
const client=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null;

app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:false,crossOriginResourcePolicy:{policy:'cross-origin'}}));
app.use(express.static(path.join(__dirname,'public')));
app.use(express.json({limit:'1mb'}));
app.use('/api',rateLimit({windowMs:60_000,max:20,standardHeaders:true,legacyHeaders:false,message:{error:'Too many requests. Please wait a minute.'}}));

const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:3}});
const allowedExt=new Set(['pdf','txt','md','js','mjs','cjs','html','css','json','py','java','cpp','c','cs','php','ts','tsx','jsx']);
function isAllowed(file){if(file.mimetype.startsWith('image/'))return true;const ext=(file.originalname.split('.').pop()||'').toLowerCase();return allowedExt.has(ext)}

app.get('/health',(_req,res)=>res.json({ok:true,aiConfigured:Boolean(client),model:MODEL}));

app.post('/api/analyze',upload.array('files',3),async(req,res)=>{
  try{
    if(!client)return res.status(503).json({error:'OPENAI_API_KEY is missing. Add it in Render → Environment, then redeploy.'});
    const mode=String(req.body.mode||'file');
    const content=String(req.body.content||'').slice(0,50000);
    const files=req.files||[];
    if(mode==='file'&&!files.length)return res.status(400).json({error:'No files received.'});
    if(mode!=='file'&&!content.trim())return res.status(400).json({error:'No text or code received.'});
    for(const f of files)if(!isAllowed(f))return res.status(415).json({error:`Unsupported file type: ${f.originalname}`});

    const instruction=`You are Analyze, a careful multimodal analysis engine. Analyze the supplied ${mode}. Return ONLY valid JSON, no markdown. Use this exact shape: {"title":string,"summary":string,"overallScore":number,"metrics":[{"label":string,"value":string,"description":string,"score":number|null}],"findings":[string],"recommendations":[string]}. Provide 8-14 useful metrics. For images discuss visible content, composition, quality, lighting, colors, visible text and metadata only if actually supplied. Never claim the exact location, camera, editing history, AI origin, authorship or authenticity as certain from appearance alone; use cautious wording and confidence estimates. For code discuss language, framework clues, correctness, maintainability, performance and security, but do not claim a complete security audit. For text/PDF summarize, identify topics, tone, structure, readability and important details. Never invent metadata. overallScore means clarity/quality/usefulness, not truth. Keep findings practical and concise.`;

    const parts=[{type:'input_text',text:instruction}];
    if(mode==='text')parts.push({type:'input_text',text:`TEXT TO ANALYZE:\n${content}`});
    if(mode==='code')parts.push({type:'input_text',text:`CODE TO ANALYZE:\n${content}`});
    for(const file of files){
      const base64=file.buffer.toString('base64');
      if(file.mimetype.startsWith('image/'))parts.push({type:'input_image',image_url:`data:${file.mimetype};base64,${base64}`,detail:'high'});
      else if(['txt','md','js','mjs','cjs','html','css','json','py','java','cpp','c','cs','php','ts','tsx','jsx'].includes((file.originalname.split('.').pop()||'').toLowerCase()))parts.push({type:'input_text',text:`FILE ${file.originalname}:\n${file.buffer.toString('utf8').slice(0,50000)}`});
      else parts.push({type:'input_file',filename:file.originalname,file_data:`data:${file.mimetype||'application/octet-stream'};base64,${base64}`});
    }

    const response=await client.responses.create({model:MODEL,input:[{role:'user',content:parts}]});
    const report=parseJson(response.output_text);
    validateReport(report);
    res.json(report);
  }catch(error){
    console.error('Analyze API error:',error);
    if(error instanceof multer.MulterError)return res.status(400).json({error:error.code==='LIMIT_FILE_SIZE'?'A file is larger than 15 MB.':error.message});
    res.status(500).json({error:'Analysis failed. Check the Render logs and API configuration.'});
  }
});

function parseJson(text){const cleaned=String(text||'').trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();try{return JSON.parse(cleaned)}catch{const start=cleaned.indexOf('{'),end=cleaned.lastIndexOf('}');if(start>=0&&end>start)return JSON.parse(cleaned.slice(start,end+1));throw new Error('Model returned invalid JSON')}}
function validateReport(r){if(!r||typeof r!=='object'||!Array.isArray(r.metrics))throw new Error('Invalid report');r.overallScore=Math.max(0,Math.min(100,Number(r.overallScore)||0));r.title=String(r.title||'Analysis Results');r.summary=String(r.summary||'');r.findings=Array.isArray(r.findings)?r.findings.map(String).slice(0,12):[];r.recommendations=Array.isArray(r.recommendations)?r.recommendations.map(String).slice(0,12):[];r.metrics=r.metrics.slice(0,16).map(m=>({label:String(m.label||'Metric'),value:String(m.value??'—'),description:String(m.description||''),score:typeof m.score==='number'?Math.max(0,Math.min(100,m.score)):null}))}

app.use((err,_req,res,_next)=>{console.error(err);if(err instanceof multer.MulterError)return res.status(400).json({error:err.code==='LIMIT_FILE_SIZE'?'A file is larger than 15 MB.':err.message});res.status(500).json({error:'Unexpected server error.'})});
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`Analyze V2 running on port ${PORT}`));
