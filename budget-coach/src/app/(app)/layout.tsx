import { CopilotKit } from "@copilotkit/react-core/v2";
import "@copilotkit/react-core/v2/styles.css";

// Scoped to the authenticated route group (see middleware.ts) so it never
// mounts on /sign-in or /sign-up — CopilotKit's runtime connection would
// otherwise hit /api/copilotkit/info while signed out, which Clerk's
// auth.protect() 404s for non-navigation requests.
const AppLayout = ({ children }: Readonly<{ children: React.ReactNode }>) => {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}>
      {children}
    </CopilotKit>
  );
};

export default AppLayout;
