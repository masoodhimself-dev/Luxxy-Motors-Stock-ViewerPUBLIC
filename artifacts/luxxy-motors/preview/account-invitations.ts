// Fictional local UI only. No Clerk, production database or email provider access.
import type {IncomingMessage,ServerResponse} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
type Invite={id:string;email:string;role:string;status:string;deliveryStatus:string;createdAt:string;expiresAt:string;acceptedAt?:string;token:string;dealerId:string;dealerName:string;ownerOnly:boolean};
const invitations=new Map<string,Invite>();
async function body(req:IncomingMessage){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>4000)throw Error('Too large');}return JSON.parse(text||'{}');}
function summary(row:Invite){const {token,dealerId,dealerName,ownerOnly,...safe}=row;return safe;}
export async function accountInvitationsPreview(req:IncomingMessage,res:ServerResponse,url:URL){
 const manager=/^\/api\/(?:staff\/team|platform\/dealers\/([^/]+))\/invitations(?:\/([^/]+)\/(resend|cancel))?\/?$/.exec(url.pathname);const publicPath=url.pathname.startsWith('/api/account-invitations/');if(!manager&&!publicPath)return false;
 const origin=`http://${req.headers.host}`,host=new URL(origin).hostname,remote=(req.socket.remoteAddress??'').replace(/^::ffff:/,'');
 const send=(status:number,value:object)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify({...value,preview:true}));};
 if(!['127.0.0.1','localhost','[::1]'].includes(host)||!['127.0.0.1','::1'].includes(remote)||(req.headers.origin&&req.headers.origin!==origin)){send(403,{error:'Invitation preview is available only on this computer.'});return true;}
 try {
  if(publicPath){const token=String(req.headers['x-account-invitation-token']??'');const row=[...invitations.values()].find(item=>item.token===token);if(!row){send(404,{error:'This fictional invitation is unavailable. Create a new one in the local preview.'});return true;}if(row.status==='cancelled'||Date.parse(row.expiresAt)<Date.now()){send(410,{error:'This invitation expired or was cancelled.'});return true;}
   if(req.method==='GET'&&url.pathname.endsWith('/preview'))send(200,{dealerName:row.dealerName,role:row.role,emailHint:row.email[0]+'•••@'+row.email.split('@')[1],expiresAt:row.expiresAt,accepted:row.status==='accepted'});
   else if(req.method==='POST'&&url.pathname.endsWith('/accept')){if(row.email!=='alex@example.com'){send(403,{error:'The local preview is signed in as alex@example.com. Use that fictional address to test acceptance.'});return true;}row.status='accepted';row.acceptedAt=new Date().toISOString();send(200,{accepted:true,dealerName:row.dealerName,portalUrl:row.ownerOnly?null:origin+'/portal'});}else send(405,{error:'Unsupported invitation action.'});return true;
  }
  const dealerId=manager![1]??'local-preview',ownerOnly=Boolean(manager![1]);
  if(req.method==='GET'){send(200,{invitations:[...invitations.values()].filter(row=>row.dealerId===dealerId).map(summary),email:{ready:true,message:'Fictional preview. No real emails are sent.'}});return true;}
  const input=await body(req);const action=manager![3];let row:Invite;
  if(action){const existing=invitations.get(manager![2]);if(!existing||existing.dealerId!==dealerId||existing.status!=='pending'){send(404,{error:'Pending invitation not found.'});return true;}row=existing;if(action==='cancel'){row.status='cancelled';send(200,{invitation:summary(row)});return true;}row.token=randomBytes(32).toString('hex');row.expiresAt=new Date(Date.now()+7*86400000).toISOString();}
  else{if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)||!['owner','salesperson','accounts'].includes(input.role)||(ownerOnly&&input.role!=='owner')){send(400,{error:'Enter a valid email and role.'});return true;}if([...invitations.values()].some(row=>row.dealerId===dealerId&&row.email===input.email&&row.status==='pending')){send(409,{error:'An invitation already exists. Use Resend instead.'});return true;}row={id:randomUUID(),dealerId,dealerName:ownerOnly?'Example Dealership':'Luxxy Motors',ownerOnly,token:randomBytes(32).toString('hex'),email:input.email.toLowerCase(),role:input.role,status:'pending',deliveryStatus:'sent',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+7*86400000).toISOString()};invitations.set(row.id,row);}
  send(201,{invitation:summary(row),previewUrl:`${origin}/join#${row.token}`});
 }catch{send(400,{error:'Check the fictional invitation request.'});}return true;
}
