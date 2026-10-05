import worker from './worker.js';
let calls=[]; let supa='ok'; let notionFail=false; let baselineRow=null;
globalThis.fetch = async (url, opts) => {
  calls.push({url:String(url), body: opts?.body});
  if (String(url).includes('mpt_score_baselines')) {
    if (opts?.method==='POST') { if (baselineRow) return {ok:true,status:201,text:async()=>'',json:async()=>[]};
      const b=JSON.parse(opts.body); baselineRow={overall_score:b.overall_score,created_at:'2026-10-05T00:00:00Z'}; return {ok:true,status:201,text:async()=>'',json:async()=>[baselineRow]}; }
    return {ok:true,status:200,text:async()=>'',json:async()=>baselineRow?[baselineRow]:[]};
  }
  if (String(url).includes('supabase.co')) return supa==='ok' ? {ok:true,status:201,text:async()=>''} : {ok:false,status:500,text:async()=>'boom'};
  if (String(url).includes('api.notion.com/v1/pages')) return notionFail?{ok:false,text:async()=>'notion down'}:{ok:true,text:async()=>'',json:async()=>({})};
  return {ok:true,status:200,text:async()=>'',json:async()=>({results:[],has_more:false})};
};
const env={NOTION_TOKEN:'n',LEADS_DB_ID:'abc-def',SUPABASE_SERVICE_ROLE_KEY:'k',HUBSPOT_TOKEN:'h',RESEND_API_KEY:'r',SLACK_BOT_TOKEN:'s'};
async function run(body, e=env){ calls=[]; const waits=[]; const req=new Request('https://x/webhook/leads',{method:'POST',headers:{'content-type':'application/json',Origin:'https://myprivacytool.io'},body:JSON.stringify(body)});
  const res=await worker.fetch(req,e,{waitUntil:p=>waits.push(p)}); await Promise.all(waits); return {status:res.status, json:await res.json(), supa:calls.filter(c=>c.url.includes('supabase.co')&&!c.url.includes('mpt_score_baselines'))}; }
let ok=true; const check=(c,m)=>{console.log((c?'PASS':'FAIL'),m); if(!c) ok=false;};
let r=await run({email:'a@b.co',riskScore:42,confirmedCount:3,source:'web_scan'});
check(r.status===200&&r.json.success,'modal path returns success');
check(r.supa.length===1&&r.supa[0].url.endsWith('/rest/v1/mpt_user_engagement'),'one insert to mpt_user_engagement');
const b=JSON.parse(r.supa[0].body); check(b.full_scan_completed===true && typeof b.session_id==='string' && !('email' in b),'full_scan_completed=true, uuid session, no email');
r=await run({email:'a@b.co',name:'A B'}); check(JSON.parse(r.supa[0].body).full_scan_completed===false,'landing form (no riskScore) => full_scan_completed=false');
supa='fail'; r=await run({email:'a@b.co',riskScore:1}); check(r.status===200&&r.json.success,'Supabase 500 does not break lead capture');
supa='ok'; r=await run({email:'a@b.co',riskScore:1},{...env,SUPABASE_SERVICE_ROLE_KEY:undefined}); check(r.status===200&&r.supa.length===0,'missing key skips write, lead still succeeds');
r=await run({email:'x@healthcheck.io'}); check(r.json.note==='healthcheck'&&r.supa.length===0,'healthcheck email still short-circuits, no write');
// MPC-6971: consent fields reach HubSpot only when consent is explicit
const hs=()=>calls.filter(c=>c.url.includes('api.hubapi.com/crm/v3/objects/contacts')).map(c=>JSON.parse(c.body).properties);
await run({email:'c@d.co',consent:true,consent_source:'web_scan_summary'});
let hp=hs()[0]; check(hp&&/^\d{4}-\d{2}-\d{2}$/.test(hp.consent_given_at)&&hp.consent_source==='web_scan_summary','explicit consent => consent_given_at (date) + consent_source sent to HubSpot');
await run({email:'c@d.co',riskScore:5,source:'web_scan'}); hp=hs()[0]; check(hp&&!('consent_given_at' in hp)&&!('consent_source' in hp),'no consent flag => consent fields NOT sent');
await run({email:'c@d.co',consent:'false'}); hp=hs()[0]; check(hp&&!('consent_given_at' in hp),'consent="false" => not treated as consent');
await run({email:'c@d.co',consent:true,consent_source:'bad value<script>'}); hp=hs()[0]; check(hp&&hp.consent_source==='badvaluescript','consent_source is sanitised');
// MPC-7120: Notion failure must not block the engagement row
notionFail=true; r=await run({email:'n@f.co',riskScore:9}); notionFail=false;
check(r.status===500&&r.supa.length===1&&JSON.parse(r.supa[0].body).full_scan_completed===true,'Notion 500 => engagement row still written');
// MPC-7173: baseline snapshot
const bl=()=>calls.filter(c=>c.url.includes('mpt_score_baselines')&&c.body);
baselineRow=null; r=await run({email:'Base@Line.co',riskScore:40,categoryScores:{fingerprint:50,'bad key!':1,social:999}});
check(r.json.baseline?.is_first===true&&r.json.baseline.overall_score===40&&r.json.baseline.delta===0,'first scan creates baseline');
let bb=JSON.parse(bl()[0].body); check(/^[0-9a-f]{64}$/.test(bb.email_hash)&&!JSON.stringify(bb).includes('@')&&JSON.stringify(bb.category_scores)==='{"fingerprint":50}','baseline keyed by email hash, no raw email, invalid categories dropped');
r=await run({email:'base@line.co',riskScore:25}); check(r.json.baseline?.is_first===false&&r.json.baseline.overall_score===40&&r.json.baseline.delta===-15,'re-scan (case-insensitive email) shows baseline and delta, does not overwrite');
r=await run({email:'z@z.co'}); check(!('baseline' in r.json)&&bl().length===0,'no riskScore => no baseline write');
r=await run({email:'z@z.co',riskScore:140}); check(!('baseline' in r.json)&&bl().length===0,'out-of-range score => no baseline write');
r=await run({email:'z@z.co',riskScore:30},{...env,SUPABASE_SERVICE_ROLE_KEY:undefined}); check(r.status===200&&!('baseline' in r.json),'missing key => lead still succeeds, no baseline');
process.exit(ok?0:1);
