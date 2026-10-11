// Isolated test adapter only; never imported by a runtime entry point.
export function getAuth(req: { get: (name: string) => string | undefined }) { return { userId:req.get('x-test-user') }; }
export const clerkClient = { users:{ getUserList:async ({ emailAddress }: { emailAddress:string[] }) => ({ data:emailAddress[0] === 'owner@example.test' ? [{id:'user_owner',firstName:'Fictional',lastName:'Owner',primaryEmailAddress:{emailAddress:'owner@example.test'}}] : [] }) } };
