import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import { checkAdministratorSession, readPublicSupabaseConfig, type PublicSupabaseConfig, type SessionCheckStatus } from './admin-session';
import type { DashboardScreen } from './gate';
import { esc } from './markup';
import { OVERVIEW_FUNCTION, type OverviewRequestBody } from './overview-contract';
import { mountLiveOverview } from './overview-live';

const CHECK_TIMEOUT_MS = 15000;

let watching = false;
let showingAuthorized = false;
let activeScreen: DashboardScreen = 'overview';
let authorizedUserId: string | null = null;
let liveOverview: { dispose: () => void } | null = null;

export async function openAdministratorGate(root: HTMLElement, screen: DashboardScreen): Promise<void> {
  activeScreen = screen;
  const config = readPublicSupabaseConfig({
    url: import.meta.env.PUBLIC_SUPABASE_URL,
    anonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
  });
  if (!config) {
    clearAccount();
    root.innerHTML = misconfigured();
    return;
  }

  let supabase: SupabaseClient;
  try {
    supabase = createClient(config.url, config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  } catch {
    clearAccount();
    root.innerHTML = misconfigured();
    return;
  }

  watchSession(supabase, config, root);
  await restoreOrSignIn(supabase, config, root);
}

async function restoreOrSignIn(supabase: SupabaseClient, config: PublicSupabaseConfig, root: HTMLElement): Promise<void> {
  let session: Session | null = null;
  try {
    const result = await withTimeout(supabase.auth.getSession(), CHECK_TIMEOUT_MS);
    session = result.data.session;
    if (result.error) session = null;
  } catch {
    renderUnavailable(root, supabase, config);
    return;
  }
  if (!session) {
    showingAuthorized = false;
    clearAccount();
    renderSignIn(root, supabase, config, '');
    return;
  }
  await finishAuthorization(supabase, config, root, session);
}

async function finishAuthorization(
  supabase: SupabaseClient,
  config: PublicSupabaseConfig,
  root: HTMLElement,
  session: Session,
): Promise<void> {
  const status = await withTimeout(checkAdministratorSession(config, session.access_token, fetch), CHECK_TIMEOUT_MS).catch(
    () => 'unavailable' as const,
  );
  if (status === 'authorized') {
    const userId = session.user.id;
    if (showingAuthorized && authorizedUserId === userId) {
      renderAccount(supabase, config, root, session.user.email ?? '');
      return;
    }
    cancelLiveOverview();
    showingAuthorized = true;
    authorizedUserId = userId;
    renderAccount(supabase, config, root, session.user.email ?? '');
    if (activeScreen === 'overview') {
      liveOverview = mountLiveOverview(
        root,
        {
          invoke: (name, body) => invokeOverview(supabase, name, body),
        },
        {
          stillCurrent: () => showingAuthorized && authorizedUserId === userId,
          onDenied: (reason) => {
            void denyAccess(supabase, config, root, reason);
          },
        },
      );
      return;
    }
    renderAuthorized(root, session.user.email ?? '');
    return;
  }
  cancelLiveOverview();
  authorizedUserId = null;
  showingAuthorized = false;
  if (status === 'invalid_session') {
    await endSession(supabase);
    renderSignIn(root, supabase, config, 'Your session is no longer valid. Sign in again.');
    return;
  }
  if (status === 'not_admin') {
    await endSession(supabase);
    clearOverviewMarker(root);
    root.innerHTML = notAdmin();
    root.querySelector<HTMLButtonElement>('#admin-try-another')?.addEventListener('click', () => {
      renderSignIn(root, supabase, config, '');
    });
    return;
  }
  renderUnavailable(root, supabase, config);
}

function renderSignIn(root: HTMLElement, supabase: SupabaseClient, config: PublicSupabaseConfig, notice: string): void {
  clearOverviewMarker(root);
  clearAccount();
  setBanner('Administrator sign-in. Customer records stay closed until the server confirms this account is an administrator.');
  root.innerHTML = `
    <section class="panel">
      <form class="signin" id="admin-sign-in">
        <h2>Sign in</h2>
        <p class="lede">Use the email and password for your existing Master Azerbaijani account. There is no separate administrator registration.</p>
        <label for="admin-email">Email
          <input id="admin-email" name="email" type="email" autocomplete="username" required spellcheck="false" />
        </label>
        <label for="admin-password">Password
          <input id="admin-password" name="password" type="password" autocomplete="current-password" required />
        </label>
        <p id="admin-sign-in-error" class="form-error" role="alert"${notice ? '' : ' hidden'}>${esc(notice)}</p>
        <button type="submit" id="admin-submit">Sign in</button>
      </form>
    </section>
  `;
  const form = root.querySelector<HTMLFormElement>('#admin-sign-in');
  const email = root.querySelector<HTMLInputElement>('#admin-email');
  const password = root.querySelector<HTMLInputElement>('#admin-password');
  const error = root.querySelector<HTMLParagraphElement>('#admin-sign-in-error');
  const submit = root.querySelector<HTMLButtonElement>('#admin-submit');
  email?.focus();
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!email || !password || !error || !submit) return;
    void submitSignIn(supabase, config, root, email, password, error, submit);
  });
}

async function submitSignIn(
  supabase: SupabaseClient,
  config: PublicSupabaseConfig,
  root: HTMLElement,
  email: HTMLInputElement,
  password: HTMLInputElement,
  error: HTMLParagraphElement,
  submit: HTMLButtonElement,
): Promise<void> {
  error.hidden = true;
  error.textContent = '';
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  const enteredEmail = email.value.trim();
  const enteredPassword = password.value;
  password.value = '';
  let session: Session | null = null;
  try {
    const result = await withTimeout(
      supabase.auth.signInWithPassword({ email: enteredEmail, password: enteredPassword }),
      CHECK_TIMEOUT_MS,
    );
    if (result.error || !result.data.session) {
      showFormError(error, signInMessage(result.error));
      submit.disabled = false;
      submit.textContent = 'Sign in';
      return;
    }
    session = result.data.session;
  } catch {
    showFormError(error, 'The account service could not be reached. No records were opened.');
    submit.disabled = false;
    submit.textContent = 'Sign in';
    return;
  }

  submit.textContent = 'Checking administrator access…';
  await finishAuthorization(supabase, config, root, session);
}

function renderAuthorized(root: HTMLElement, email: string): void {
  setBanner('Administrator access confirmed. Records on this page are not connected yet.');
  const who = email ? `Signed in as ${email}. ` : '';
  root.innerHTML = `
    <section class="panel">
      <h2>Administrator access confirmed</h2>
      <p class="lede">${esc(who)}The server confirmed this account is an administrator.</p>
      <p>Learner and purchase records are not connected on this page. This page did not load customer information.</p>
    </section>
  `;
}

function renderUnavailable(root: HTMLElement, supabase: SupabaseClient, config: PublicSupabaseConfig): void {
  clearOverviewMarker(root);
  showingAuthorized = false;
  authorizedUserId = null;
  cancelLiveOverview();
  setBanner('The administrator check did not finish. No customer records were opened.');
  root.innerHTML = `
    <section class="panel">
      <h2>Administrator check unavailable</h2>
      <p class="lede">The dashboard could not complete the server authorization check. No records were opened.</p>
      <div class="signin-actions">
        <button type="button" id="admin-retry">Try again</button>
        <button type="button" id="admin-unavailable-sign-out">Sign out</button>
      </div>
    </section>
  `;
  root.querySelector<HTMLButtonElement>('#admin-retry')?.addEventListener('click', () => {
    void restoreOrSignIn(supabase, config, root);
  });
  root.querySelector<HTMLButtonElement>('#admin-unavailable-sign-out')?.addEventListener('click', () => {
    void (async () => {
      await endSession(supabase);
      renderSignIn(root, supabase, config, '');
    })();
  });
}

function renderAccount(supabase: SupabaseClient, config: PublicSupabaseConfig, root: HTMLElement, email: string): void {
  const slot = document.getElementById('dashboard-account');
  if (!slot) return;
  slot.innerHTML = `
    <p class="account-line">${esc(email || 'Administrator')}</p>
    <button type="button" id="dashboard-sign-out">Sign out</button>
  `;
  slot.querySelector<HTMLButtonElement>('#dashboard-sign-out')?.addEventListener('click', () => {
    void (async () => {
      showingAuthorized = false;
      authorizedUserId = null;
      cancelLiveOverview();
      await endSession(supabase);
      renderSignIn(root, supabase, config, '');
    })();
  });
}

function watchSession(supabase: SupabaseClient, config: PublicSupabaseConfig, root: HTMLElement): void {
  if (watching) return;
  watching = true;
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      const wasAuthorized = showingAuthorized;
      showingAuthorized = false;
      authorizedUserId = null;
      cancelLiveOverview();
      clearAccount();
      if (wasAuthorized) renderSignIn(root, supabase, config, 'You have been signed out.');
      return;
    }
    if (event === 'TOKEN_REFRESHED' && showingAuthorized && session) {
      void finishAuthorization(supabase, config, root, session);
    }
    if (event === 'TOKEN_REFRESHED' && showingAuthorized && !session) {
      showingAuthorized = false;
      authorizedUserId = null;
      cancelLiveOverview();
      clearAccount();
      renderSignIn(root, supabase, config, 'Your session is no longer valid. Sign in again.');
    }
  });
}

async function denyAccess(
  supabase: SupabaseClient,
  config: PublicSupabaseConfig,
  root: HTMLElement,
  reason: 'invalid_session' | 'not_admin',
): Promise<void> {
  showingAuthorized = false;
  authorizedUserId = null;
  cancelLiveOverview();
  await endSession(supabase);
  if (reason === 'not_admin') {
    clearOverviewMarker(root);
    root.innerHTML = notAdmin();
    root.querySelector<HTMLButtonElement>('#admin-try-another')?.addEventListener('click', () => {
      renderSignIn(root, supabase, config, '');
    });
    return;
  }
  renderSignIn(root, supabase, config, 'Your session is no longer valid. Sign in again.');
}

function cancelLiveOverview(): void {
  liveOverview?.dispose();
  liveOverview = null;
}

async function invokeOverview(
  supabase: SupabaseClient,
  name: typeof OVERVIEW_FUNCTION,
  body: OverviewRequestBody,
): Promise<{ data: unknown; error: unknown }> {
  return supabase.functions.invoke(name, { body, timeout: CHECK_TIMEOUT_MS });
}

async function endSession(supabase: SupabaseClient): Promise<void> {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {
    // The local session is cleared by the call when it can be. The screen still returns to sign-in.
  }
  clearAccount();
}

function clearOverviewMarker(root: HTMLElement): void {
  delete root.dataset.overviewState;
  delete root.dataset.ready;
}

function clearAccount(): void {
  const slot = document.getElementById('dashboard-account');
  if (slot) slot.innerHTML = '';
}

function showFormError(error: HTMLParagraphElement, message: string): void {
  error.hidden = false;
  error.textContent = message;
}

function signInMessage(error: { name?: string; status?: number } | null): string {
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0) {
    return 'The account service could not be reached. No records were opened.';
  }
  return 'The email or password was not accepted.';
}

function misconfigured(): string {
  return `<section class="panel"><h2>Dashboard sign-in is not configured</h2><p class="lede">The public Supabase address and publishable key have to be set before an administrator can sign in. Customer records are not included on this page.</p></section>`;
}

function notAdmin(): string {
  setBanner('This account is not an administrator. No customer records were opened.');
  return `<section class="panel"><h2>This account is not an administrator</h2><p class="lede">Sign-in succeeded, but the server did not authorize this account for the dashboard. No records were opened.</p><button type="button" id="admin-try-another">Sign in with a different account</button></section>`;
}

function setBanner(message: string): void {
  const banner = document.getElementById('dashboard-banner');
  if (!banner) return;
  banner.textContent = '';
  const paragraph = document.createElement('p');
  paragraph.textContent = message;
  banner.append(paragraph);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type { SessionCheckStatus };
