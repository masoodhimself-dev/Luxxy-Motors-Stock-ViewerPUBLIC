import { useEffect,useState } from 'react';
import { SignInButton,useAuth,useClerk,useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from '@/components/icons';
import './join.css';
import { invitationTokenFromBrowser, clearInvitationToken } from '@/lib/account-invitation-token';
type Preview={dealerName:string;role:string;emailHint:string;expiresAt:string;accepted:boolean;preview?:boolean};
export default function JoinDealership() {
  const {isLoaded,isSignedIn}=useAuth();const {user}=useUser();const clerk=useClerk();
  const [token]=useState(invitationTokenFromBrowser),[data,setData]=useState<Preview>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState<{dealerName:string;portalUrl:string|null}>();
  async function load(){setError('');try{if(!token)throw new Error('Open the invitation link from your email to continue.');setData(await customFetch<Preview>('/api/account-invitations/preview',{headers:{'x-account-invitation-token':token}}));}catch(cause){setError(cause instanceof Error?cause.message:'Your invitation could not be loaded.');}}
  useEffect(()=>{document.title='Join your dealership';void load();},[token]);
  async function accept(){setBusy(true);setError('');try{const accepted=await customFetch<{dealerName:string;portalUrl:string|null}>('/api/account-invitations/accept',{method:'POST',headers:{'x-account-invitation-token':token,'Content-Type':'application/json'},body:'{}'});setResult(accepted);clearInvitationToken();window.history.replaceState(null,'','/join');}catch(cause){setError(cause instanceof Error?cause.message:'Could not accept your invitation. Try again.');}finally{setBusy(false);}}
  return <main className="account-join-page"><div className="account-join-brand">LUXXY <span>Dealer platform</span></div><section className="account-join-card"><ShieldCheck size={28} aria-hidden="true"/><p className="account-join-kicker">Your dealership account</p><h1>{result?'You’re ready':data?`Join ${data.dealerName}`:'Welcome to your dealership'}</h1>
    {data?.preview&&<p className="account-join-detail" role="note">Fictional local preview. No real emails or account access changes.</p>}
    {result?<><p>Your account now has access to {result.dealerName}.</p>{result.portalUrl?<a href={result.portalUrl} className="account-join-open">Open dealership portal</a>:<p className="account-join-detail">Your dealership’s website is still being prepared. We’ll share its portal address when setup is complete. Your account is ready.</p>}</>:<>
      {error&&<p role="alert" className="account-join-error">{error}</p>}
      {!data&&!error&&<p role="status">Checking your invitation…</p>}
      {data&&<><p>You’ve been invited as {data.role==='owner'?'an owner':data.role==='accounts'?'a member of the accounts team':'a salesperson'}. This gives access to this dealership only.</p><div className="account-join-detail"><strong>Use the invited email</strong><span>{data.emailHint}</span><small>Invitation expires {new Date(data.expiresAt).toLocaleDateString('en-GB')}.</small></div>
        {!isLoaded?<p role="status">Checking sign-in…</p>:!isSignedIn?<><p>Create an account or sign in, then return here to accept. You’ll verify your email as part of the account setup.</p><SignInButton mode="redirect" forceRedirectUrl="/join" signUpForceRedirectUrl="/join"><Button>Create account or sign in</Button></SignInButton></>:<><p className="account-join-signed-in">Signed in as <strong>{user?.primaryEmailAddress?.emailAddress??'your staff account'}</strong></p><Button disabled={busy} onClick={()=>void accept()}>{busy?'Accepting…':'Accept invitation'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>void clerk.signOut({redirectUrl:'/join'})}>Use a different account</Button></>}
      </>}
      {!data&&error&&token&&<Button type="button" variant="outline" onClick={()=>void load()}>Try again</Button>}
    </>}
    <p className="account-join-footer">Access is added only after you sign in with the invited email and accept. You never need to share your password.</p>
  </section></main>;
}
