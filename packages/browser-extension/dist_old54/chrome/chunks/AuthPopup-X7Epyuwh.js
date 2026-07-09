import{r as i,j as e}from"./client-6mHhEDkH.js";import{e as F,f as D,r as P,h as v,j as B}from"./MessageHandler-BNezBCQN.js";const R=`-- TabFlow Database Setup — paste this entire block and click "Run"

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  encryption_salt text NOT NULL,
  canary text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS canary text;

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL,
  icon text,
  sort_order bigint NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tabs (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL,
  favicon_url text,
  sort_order bigint NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  last_accessed timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.active_devices (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text NOT NULL DEFAULT 'Unknown Device',
  claimed_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_is_active ON public.workspaces(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_tabs_workspace_id ON public.tabs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tabs_user_id ON public.tabs(user_id);
CREATE INDEX IF NOT EXISTS idx_tabs_is_pinned ON public.tabs(workspace_id, is_pinned);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON public.sessions(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_workspaces_updated_at ON public.workspaces;
CREATE TRIGGER update_workspaces_updated_at
  BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tabs_updated_at ON public.tabs;
CREATE TRIGGER update_tabs_updated_at
  BEFORE UPDATE ON public.tabs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_devices ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can insert own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can update own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can delete own settings" ON public.user_settings;
  DROP POLICY IF EXISTS "Users can view own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can create own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can update own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can delete own workspaces" ON public.workspaces;
  DROP POLICY IF EXISTS "Users can view own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can create own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can update own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can delete own tabs" ON public.tabs;
  DROP POLICY IF EXISTS "Users can view own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can create own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can update own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can delete own sessions" ON public.sessions;
  DROP POLICY IF EXISTS "Users can manage their own active device" ON public.active_devices;
END $$;

CREATE POLICY "Users can view own settings" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own settings" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own settings" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own settings" ON public.user_settings FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own workspaces" ON public.workspaces FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own workspaces" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workspaces" ON public.workspaces FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own workspaces" ON public.workspaces FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own tabs" ON public.tabs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own tabs" ON public.tabs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own tabs" ON public.tabs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own tabs" ON public.tabs FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can view own sessions" ON public.sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create own sessions" ON public.sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sessions" ON public.sessions FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own sessions" ON public.sessions FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own active device" ON public.active_devices FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Data API grants (required for new projects after May 30, 2026; idempotent).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tabs            TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions        TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.active_devices  TO authenticated, service_role;
-- Workspace history (per-workspace tab snapshots for the History panel).
CREATE TABLE IF NOT EXISTS public.workspace_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  tab_snapshots jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workspace_history_user_workspace_idx ON public.workspace_history(user_id, workspace_id, created_at DESC);
ALTER TABLE public.workspace_history ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS workspace_history_owner_all ON public.workspace_history; END $$;
CREATE POLICY workspace_history_owner_all ON public.workspace_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_history TO authenticated, service_role;

-- Deleted workspaces (recycle bin).
CREATE TABLE IF NOT EXISTS public.deleted_workspaces (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  workspace_data jsonb NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deleted_workspaces_user_idx ON public.deleted_workspaces(user_id, deleted_at DESC);
ALTER TABLE public.deleted_workspaces ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN DROP POLICY IF EXISTS deleted_workspaces_owner_all ON public.deleted_workspaces; END $$;
CREATE POLICY deleted_workspaces_owner_all ON public.deleted_workspaces FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deleted_workspaces TO authenticated, service_role;

-- Workspace shortName (1-3 char label on pinned-tab favicon).
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS short_name text;

ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 0.1.46: per-tab "persistent" flag drives the Firefox-only keep-alive feature.
-- When true, the tab is hidden on workspace switch instead of closed.
ALTER TABLE public.tabs ADD COLUMN IF NOT EXISTS persistent boolean NOT NULL DEFAULT false;

DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.workspaces; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.tabs; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.active_devices; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
`,W=({onComplete:C,onSkip:E})=>{const[u,r]=i.useState("welcome"),[N,b]=i.useState(""),[T,g]=i.useState(""),[m,h]=i.useState(""),[l,n]=i.useState(!1),[x,L]=i.useState(!1),[I,S]=i.useState(!1),f=async()=>{var o,d;try{await navigator.clipboard.writeText(R),L(!0),setTimeout(()=>L(!1),2e3)}catch{const c=document.getElementById("setup-sql-block");if(c){const y=document.createRange();y.selectNodeContents(c),(o=window.getSelection())==null||o.removeAllRanges(),(d=window.getSelection())==null||d.addRange(y)}}},w=async()=>{h(""),n(!0);try{if(!N.trim()||!T.trim()){h("Both fields are required."),n(!1);return}const o=N.trim().replace(/\/$/,"");if(!o.startsWith("https://")||!o.includes(".supabase.co")){h("URL should look like https://xxxxx.supabase.co"),n(!1);return}const d=await fetch(`${o}/auth/v1/settings`,{headers:{apikey:T.trim()}});if(!d.ok){let c;switch(d.status){case 401:c='HTTP 401: your API key is being rejected. Most common causes: (1) the key was copied incomplete — publishable/anon keys are usually 40+ characters; (2) you copied the JWT "secret" or "service_role" key by mistake; (3) the project is paused on Supabase (free projects pause after 1 week of inactivity — visit your dashboard to resume it).';break;case 403:c='HTTP 403: key accepted but access is denied. Check that you copied the "anon" or "publishable" key (not a restricted/scoped key).';break;case 404:c='HTTP 404: the Project URL seems wrong. It should look like "https://<project-ref>.supabase.co" where <project-ref> is a ~20-character string.';break;case 500:case 502:case 503:case 504:c=`HTTP ${d.status}: Supabase is having trouble responding. Wait a moment and try again.`;break;default:c=`Connection failed (HTTP ${d.status}). Double-check your URL and anon key.`}h(c),n(!1);return}await F(o,T.trim()),D(),P(),r("success")}catch{h("Could not reach the Supabase project. Check your URL and try again.")}finally{n(!1)}};return e.jsx("div",{style:s.container,children:e.jsxs("div",{style:s.card,children:[u==="welcome"&&e.jsxs(e.Fragment,{children:[e.jsx("h1",{style:s.heading,children:"Welcome to TabFlow"}),e.jsx("p",{style:s.body,children:"TabFlow organizes your browser tabs into workspaces. You can use it entirely on this computer, or enable cloud sync to keep your workspaces in sync across multiple devices."}),e.jsx("p",{style:{...s.body,fontWeight:500,color:"#d0d8e0"},children:"Would you like to enable cloud sync?"}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"10px",marginTop:"20px"},children:[e.jsx("button",{style:s.primaryButton,onClick:()=>r("has-account"),children:"Yes, set up cloud sync"}),e.jsx("button",{style:s.secondaryButtonFull,onClick:()=>{chrome.storage.local.set({tabflow_local_only:!0}),E()},children:"No thanks, just use it on this device"})]})]}),u==="has-account"&&e.jsxs(e.Fragment,{children:[e.jsx("h1",{style:s.heading,children:"Cloud Sync Setup"}),e.jsxs("p",{style:s.body,children:["TabFlow uses"," ",e.jsx("a",{href:"https://supabase.com",target:"_blank",rel:"noopener noreferrer",style:s.link,children:"Supabase"})," ","(a free cloud database) to sync your tabs. Your data is end-to-end encrypted — nobody can read it except you."]}),e.jsx("p",{style:{...s.body,fontWeight:500,color:"#d0d8e0"},children:"Do you already have a Supabase project set up for TabFlow?"}),e.jsxs("div",{style:{display:"flex",flexDirection:"column",gap:"10px",marginTop:"20px"},children:[e.jsx("button",{style:s.primaryButton,onClick:()=>{S(!1),r("enter-credentials")},children:"Yes, I have my project URL and key"}),e.jsx("button",{style:s.secondaryButtonFull,onClick:()=>{S(!0),r("new-project")},children:"No, I need to create one (free, ~5 min)"})]}),e.jsx("div",{style:{marginTop:"16px",textAlign:"center"},children:e.jsx("a",{style:{...s.link,fontSize:"13px",cursor:"pointer"},onClick:()=>r("welcome"),children:"Back"})})]}),u==="new-project"&&e.jsxs(e.Fragment,{children:[e.jsx("h1",{style:s.heading,children:"Create a Supabase Project"}),e.jsxs("div",{style:s.instructionBlock,children:[e.jsx("div",{style:s.instructionNumber,children:"1"}),e.jsx("div",{children:e.jsxs("p",{style:s.body,children:["Go to"," ",e.jsx("a",{href:"https://supabase.com/dashboard",target:"_blank",rel:"noopener noreferrer",style:s.link,children:"supabase.com/dashboard"})," ","and create a free account (or sign in)."]})})]}),e.jsxs("div",{style:s.instructionBlock,children:[e.jsx("div",{style:s.instructionNumber,children:"2"}),e.jsx("div",{children:e.jsxs("p",{style:s.body,children:["Click ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"New Project"}),". Pick any name and a strong database password (you won't need this password in TabFlow)."]})})]}),e.jsxs("div",{style:s.instructionBlock,children:[e.jsx("div",{style:s.instructionNumber,children:"3"}),e.jsx("div",{children:e.jsx("p",{style:s.body,children:"Wait for the project to finish setting up (about 1 minute), then continue."})})]}),e.jsxs("div",{style:s.buttonRow,children:[e.jsx("button",{style:s.secondaryButton,onClick:()=>r("has-account"),children:"Back"}),e.jsx("button",{style:s.primaryButton,onClick:()=>r("run-sql"),children:"My Project is Ready"})]})]}),u==="run-sql"&&e.jsxs(e.Fragment,{children:[e.jsx("h1",{style:s.heading,children:"Set Up the Database"}),e.jsxs("div",{style:s.instructionBlock,children:[e.jsx("div",{style:s.instructionNumber,children:"1"}),e.jsx("div",{children:e.jsxs("p",{style:s.body,children:["In your Supabase dashboard, click"," ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"SQL Editor"})," in the left sidebar."]})})]}),e.jsxs("div",{style:s.instructionBlock,children:[e.jsx("div",{style:s.instructionNumber,children:"2"}),e.jsx("div",{children:e.jsxs("p",{style:s.body,children:["Click ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"New Query"}),", paste the SQL below, and click ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"Run"}),"."]})})]}),e.jsxs("div",{style:s.sqlContainer,children:[e.jsxs("div",{style:s.sqlHeader,children:[e.jsx("span",{style:{fontSize:"12px",color:"#8b8fa3"},children:"TabFlow Setup SQL"}),e.jsx("button",{style:s.copyButton,onClick:f,children:x?"Copied!":"Copy"})]}),e.jsx("pre",{id:"setup-sql-block",style:s.sqlBlock,children:R.slice(0,500)+`

  ... (click Copy to get the full script)`})]}),e.jsxs("div",{style:s.buttonRow,children:[e.jsx("button",{style:s.secondaryButton,onClick:()=>r("new-project"),children:"Back"}),e.jsx("button",{style:s.primaryButton,onClick:()=>r("enter-credentials"),children:"I've Run the SQL"})]})]}),u==="enter-credentials"&&e.jsxs(e.Fragment,{children:[e.jsx("h1",{style:s.heading,children:"Connect Your Supabase Project"}),e.jsx("p",{style:s.body,children:"Grab two values from your Supabase project dashboard:"}),e.jsxs("ol",{style:s.steps,children:[e.jsxs("li",{style:s.step,children:["Open"," ",e.jsx("a",{href:"https://supabase.com/dashboard",target:"_blank",rel:"noreferrer",style:s.link,children:"supabase.com/dashboard"})," ","and click into your project."]}),e.jsxs("li",{style:s.step,children:["The ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"Project URL"})," is shown right under your project name at the top of the page (it looks like"," ",e.jsx("code",{style:s.code,children:"https://xxxxx.supabase.co"}),"). Use the"," ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"Copy"})," button next to it and paste it below."]}),e.jsxs("li",{style:s.step,children:["For the ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"API key"}),", click"," ",e.jsx("strong",{style:{color:"#e0e6ed"},children:"API Keys"}),' in the "Get connected" row on the dashboard (or in the left-hand gear menu). Copy the key labeled'," ",e.jsx("em",{children:'"publishable"'})," (starts with ",e.jsx("code",{style:s.code,children:"sb_publishable_…"}),") or ",e.jsx("em",{children:'"anon public"'})," (starts with ",e.jsx("code",{style:s.code,children:"eyJ…"}),") — either format works.",e.jsxs("div",{style:{marginTop:"8px"},children:[e.jsx("strong",{style:{color:"#ff7a7a"},children:"Do not"})," copy any key labeled"," ",e.jsx("em",{children:'"secret"'})," or ",e.jsx("em",{children:'"service_role"'})," — those have admin access and must never be in a browser extension."]})]})]}),m&&e.jsx("div",{style:s.errorBox,children:m}),e.jsxs("div",{style:s.formGroup,children:[e.jsx("label",{style:s.label,children:"Project URL"}),e.jsx("input",{style:s.input,type:"text",placeholder:"https://abcdefghijklmnop.supabase.co",value:N,onChange:o=>b(o.target.value),onFocus:o=>o.currentTarget.style.borderColor="#6c8cff",onBlur:o=>o.currentTarget.style.borderColor="#3a3f4b"})]}),e.jsxs("div",{style:s.formGroup,children:[e.jsx("label",{style:s.label,children:"Anon / Publishable Key"}),e.jsx("input",{style:s.input,type:"text",placeholder:"eyJhbGciOi…  or  sb_publishable_…",value:T,onChange:o=>g(o.target.value),onFocus:o=>o.currentTarget.style.borderColor="#6c8cff",onBlur:o=>o.currentTarget.style.borderColor="#3a3f4b"}),e.jsx("span",{style:s.hint,children:"Usually 40+ characters. Paste the whole thing — getting cut off causes 401 errors."})]}),e.jsxs("div",{style:s.buttonRow,children:[e.jsx("button",{style:s.secondaryButton,onClick:()=>r(I?"run-sql":"has-account"),children:"Back"}),e.jsx("button",{style:{...s.primaryButton,opacity:l?.7:1},onClick:w,disabled:l,children:l?"Testing…":"Test Connection"})]})]}),u==="success"&&e.jsxs(e.Fragment,{children:[e.jsx("div",{style:s.successIcon,children:"✓"}),e.jsx("h1",{style:s.heading,children:"Connected!"}),e.jsx("p",{style:s.body,children:"TabFlow is connected to your Supabase project. Next, create an account (or sign in) and set your encryption passphrase."}),e.jsx("button",{style:s.primaryButton,onClick:C,children:"Continue to Sign In"})]})]})})},s={container:{width:"100%",minHeight:"100%",backgroundColor:"#0f1117",display:"flex",alignItems:"center",justifyContent:"center",padding:"40px 20px",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',boxSizing:"border-box"},card:{width:"100%",maxWidth:"560px",backgroundColor:"#1a1d27",borderRadius:"12px",padding:"36px 32px",border:"1px solid #2a2d3a"},heading:{fontSize:"22px",fontWeight:600,color:"#e0e6ed",marginBottom:"12px",marginTop:0,textAlign:"center"},body:{fontSize:"14px",color:"#9ca3af",lineHeight:1.6,marginBottom:"12px",marginTop:0},instructionBlock:{display:"flex",gap:"14px",alignItems:"flex-start",marginBottom:"16px"},instructionNumber:{width:"26px",height:"26px",borderRadius:"50%",backgroundColor:"#6c8cff",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"13px",fontWeight:700,flexShrink:0,marginTop:"2px"},sqlContainer:{borderRadius:"8px",border:"1px solid #2a2d3a",overflow:"hidden",marginBottom:"24px"},sqlHeader:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",backgroundColor:"#12141c",borderBottom:"1px solid #2a2d3a"},copyButton:{backgroundColor:"#6c8cff",color:"#fff",border:"none",borderRadius:"4px",padding:"4px 12px",fontSize:"12px",fontWeight:600,cursor:"pointer"},sqlBlock:{backgroundColor:"#12141c",color:"#8b8fa3",padding:"12px",fontSize:"11px",lineHeight:1.5,overflow:"auto",maxHeight:"180px",margin:0,whiteSpace:"pre-wrap",wordBreak:"break-all"},formGroup:{marginBottom:"18px"},label:{display:"block",fontSize:"13px",fontWeight:500,color:"#d0d8e0",marginBottom:"6px"},input:{width:"100%",padding:"10px 12px",backgroundColor:"#12141c",border:"1px solid #3a3f4b",borderRadius:"6px",color:"#e0e6ed",fontSize:"14px",boxSizing:"border-box",outline:"none",transition:"border-color 0.2s"},hint:{fontSize:"12px",color:"#6b7080",marginTop:"4px",display:"block"},steps:{paddingLeft:"22px",margin:"0 0 20px 0",color:"#b8c0cc",fontSize:"14px",lineHeight:"1.65"},step:{marginBottom:"10px"},code:{fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace",fontSize:"12px",backgroundColor:"#12141c",border:"1px solid #2a2f3a",borderRadius:"4px",padding:"1px 5px",color:"#e0e6ed"},link:{color:"#6c8cff",textDecoration:"none"},errorBox:{backgroundColor:"#7f1d1d",color:"#fecaca",padding:"12px",borderRadius:"6px",fontSize:"13px",lineHeight:"1.55",marginBottom:"16px"},buttonRow:{display:"flex",gap:"12px",justifyContent:"flex-end",marginTop:"24px"},primaryButton:{backgroundColor:"#6c8cff",color:"#fff",border:"none",borderRadius:"8px",padding:"10px 24px",fontSize:"14px",fontWeight:600,cursor:"pointer",transition:"opacity 0.15s"},secondaryButton:{backgroundColor:"transparent",color:"#8b8fa3",border:"1px solid #3a3f4b",borderRadius:"8px",padding:"10px 20px",fontSize:"14px",fontWeight:500,cursor:"pointer"},secondaryButtonFull:{backgroundColor:"transparent",color:"#8b8fa3",border:"1px solid #3a3f4b",borderRadius:"8px",padding:"10px 24px",fontSize:"14px",fontWeight:500,cursor:"pointer",width:"100%"},successIcon:{width:"56px",height:"56px",borderRadius:"50%",backgroundColor:"#166534",color:"#4ade80",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"28px",fontWeight:700,margin:"0 auto 20px"}},G=({onAuthenticated:C})=>{const[E,u]=i.useState("signin"),[r,N]=i.useState(""),[b,T]=i.useState(""),[g,m]=i.useState(""),[h,l]=i.useState(""),[n,x]=i.useState(!1);i.useEffect(()=>{var t;(t=chrome.storage.session)==null||t.get(["authForm_mode","authForm_email","authForm_password","authForm_passphrase"],a=>{a.authForm_mode&&u(a.authForm_mode),a.authForm_email&&N(a.authForm_email),a.authForm_password&&T(a.authForm_password),a.authForm_passphrase&&m(a.authForm_passphrase)})},[]);const L=(t,a,p)=>{var O;p(a),(O=chrome.storage.session)==null||O.set({[`authForm_${t}`]:a})},I=async t=>{var a;t.preventDefault(),l(""),x(!0);try{if(!r||!b||!g){l("All fields are required"),x(!1);return}if(b.length<6){l("Password must be at least 6 characters"),x(!1);return}if(g.length<8){l("Encryption passphrase must be at least 8 characters"),x(!1);return}let p;E==="signup"?p=await v(r,b):p=await B(r,b),typeof chrome<"u"&&chrome.storage&&(chrome.storage.local.set({encryptionPassphrase:g,userId:p.id}),(a=chrome.storage.session)==null||a.remove(["authForm_mode","authForm_email","authForm_password","authForm_passphrase"])),C&&C(p)}catch(p){const O=p instanceof Error?p.message:"An error occurred";l(O)}finally{x(!1)}},S={backgroundColor:"#1a1d27",color:"#e0e6ed",width:"400px",minHeight:"500px",display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"0",fontFamily:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'},f={width:"100%",backgroundColor:"#1a1d27",borderRadius:"0",padding:"24px 20px",boxShadow:"none"},w={fontSize:"24px",fontWeight:"600",marginBottom:"8px",textAlign:"center"},o={fontSize:"14px",color:"#9ca3af",textAlign:"center",marginBottom:"24px"},d={marginBottom:"16px"},c={display:"block",fontSize:"13px",fontWeight:"500",marginBottom:"6px",color:"#d0d8e0"},y={width:"100%",padding:"10px 12px",backgroundColor:"#1a1d27",border:"1px solid #3a3f4b",borderRadius:"6px",color:"#e0e6ed",fontSize:"14px",boxSizing:"border-box",outline:"none",transition:"border-color 0.2s"};({...y});const A={fontSize:"12px",color:"#9ca3af",marginTop:"4px",fontStyle:"italic"},k={width:"100%",padding:"10px",backgroundColor:"#6c8cff",color:"#fff",border:"none",borderRadius:"6px",fontSize:"14px",fontWeight:"600",cursor:n?"not-allowed":"pointer",opacity:n?.7:1,marginTop:"20px",transition:"opacity 0.2s"},U={backgroundColor:"#7f1d1d",color:"#fecaca",padding:"12px",borderRadius:"6px",fontSize:"13px",marginBottom:"16px"},j={textAlign:"center",marginTop:"16px",fontSize:"13px"},_={color:"#6c8cff",cursor:"pointer",textDecoration:"none"};return e.jsx("div",{style:S,children:e.jsxs("form",{style:f,onSubmit:I,children:[e.jsx("h1",{style:w,children:E==="signin"?"Sign In":"Create Account"}),e.jsx("p",{style:o,children:E==="signin"?"Welcome back to TabFlow":"Join TabFlow and sync your tabs"}),h&&e.jsx("div",{style:U,children:h}),e.jsxs("div",{style:d,children:[e.jsx("label",{htmlFor:"tabflow-email",style:c,children:"Email"}),e.jsx("input",{id:"tabflow-email",name:"email",type:"email",autoComplete:"email",value:r,onChange:t=>L("email",t.target.value,N),placeholder:"you@example.com",style:y,onFocus:t=>t.currentTarget.style.borderColor="#6c8cff",onBlur:t=>t.currentTarget.style.borderColor="#3a3f4b",disabled:n,required:!0})]}),e.jsxs("div",{style:d,children:[e.jsx("label",{htmlFor:"tabflow-password",style:c,children:"Password"}),e.jsx("input",{id:"tabflow-password",name:"password",type:"password",autoComplete:E==="signup"?"new-password":"current-password",value:b,onChange:t=>L("password",t.target.value,T),placeholder:"At least 6 characters",style:y,onFocus:t=>t.currentTarget.style.borderColor="#6c8cff",onBlur:t=>t.currentTarget.style.borderColor="#3a3f4b",disabled:n,required:!0})]}),e.jsxs("div",{style:d,children:[e.jsx("label",{htmlFor:"tabflow-passphrase",style:c,children:"Encryption Passphrase"}),e.jsx("input",{id:"tabflow-passphrase",name:"passphrase",type:"password",autoComplete:"off",value:g,onChange:t=>L("passphrase",t.target.value,m),placeholder:"Create a strong passphrase",style:y,onFocus:t=>t.currentTarget.style.borderColor="#6c8cff",onBlur:t=>t.currentTarget.style.borderColor="#3a3f4b",disabled:n,required:!0}),e.jsx("div",{style:A,children:"This passphrase encrypts your data. It never leaves your device."})]}),e.jsx("button",{type:"submit",style:k,disabled:n,children:n?"Please wait...":E==="signin"?"Sign In":"Sign Up"}),e.jsx("div",{style:j,children:E==="signin"?e.jsxs(e.Fragment,{children:["Don't have an account?"," ",e.jsx("a",{style:_,onClick:()=>{var t;u("signup"),l(""),(t=chrome.storage.session)==null||t.set({authForm_mode:"signup"})},children:"Sign up"})]}):e.jsxs(e.Fragment,{children:["Already have an account?"," ",e.jsx("a",{style:_,onClick:()=>{var t;u("signin"),l(""),(t=chrome.storage.session)==null||t.set({authForm_mode:"signin"})},children:"Sign in"})]})})]})})};export{G as A,W as S};
