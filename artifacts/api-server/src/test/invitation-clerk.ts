export const invitationProfiles=new Map<string,any>();
export function getAuth(req:{get:(name:string)=>string|undefined}){return {userId:req.get('x-test-user')||null};}
export const clerkClient={users:{getUser:async(id:string)=>{const profile=invitationProfiles.get(id);if(!profile)throw Error('Fictional profile missing');return profile;},getUserList:async({emailAddress}:{emailAddress:string[]})=>({data:[...invitationProfiles.values()].filter(profile=>profile.emailAddresses.some((email:any)=>email.emailAddress===emailAddress[0]))})}};
