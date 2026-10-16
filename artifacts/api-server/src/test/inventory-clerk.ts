// Fictional test identity adapter. Never loaded by a production entry point.
export function getAuth(req: { get: (name: string) => string | undefined }) {
  return { userId: req.get("x-test-user") };
}
export const clerkClient = {
  users: {
    getUser: async (id: string) => ({
      firstName: id,
      lastName: "Test",
      primaryEmailAddress: { emailAddress: id + "@example.test" },
      emailAddresses: [],
    }),
  },
};
