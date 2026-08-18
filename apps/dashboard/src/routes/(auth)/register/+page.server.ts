import { fail, redirect } from '@sveltejs/kit';
import { classroomio } from '$lib/utils/services/api';
import { getApiKeyHeaders, safeServerApi } from '$lib/utils/services/api/server';
import { REGISTRATION_HONEYPOT_FIELD } from '@cio/utils/constants';
import type { Actions, PageServerLoad } from './$types';

// PearlLMS Phase 7 — the public registration form (docs/ONBOARDING-MODEL.md §8). Unauthenticated: it lives in
// the (auth) group (no app-layout guard). The server load + submit action call the API with the server's
// api key (getApiKeyHeaders) — the browser never holds it — and forward the visitor's IP as x-forwarded-for
// so the API's per-IP rate limit sees the real client. The action creates ONLY a pending application.

interface CoursesResponse {
  success: true;
  data: { courseId: string; title: string | null }[];
}

export const load: PageServerLoad = async () => {
  const result = await safeServerApi<CoursesResponse>(() => classroomio.register.courses.$get(getApiKeyHeaders()));
  return { courses: result.ok ? result.body.data : [] };
};

export const actions: Actions = {
  default: async ({ request, getClientAddress }) => {
    const form = await request.formData();
    const fullName = (form.get('fullName')?.toString() ?? '').trim();
    const email = (form.get('email')?.toString() ?? '').trim();
    const requestedCourseId = form.get('requestedCourseId')?.toString() || undefined;
    const honeypot = form.get(REGISTRATION_HONEYPOT_FIELD)?.toString() ?? '';

    if (!fullName || !email) {
      return fail(400, { message: 'Please enter your name and email.', fullName, email });
    }

    const apiKey = getApiKeyHeaders();
    const result = await safeServerApi<{ success: true; data: { ok: true } }>(() =>
      classroomio.register.$post(
        {
          json: {
            fullName,
            email,
            requestedCourseId,
            [REGISTRATION_HONEYPOT_FIELD]: honeypot
          }
        },
        { headers: { ...apiKey.headers, 'x-forwarded-for': getClientAddress() } }
      )
    );

    if (result.ok) {
      redirect(303, '/register/thanks');
    }

    // Neutral messages — never reveal whether an email already exists (no enumeration).
    if (result.status === 429) {
      return fail(429, { message: 'Too many attempts. Please try again in a minute.', fullName, email });
    }
    if (result.status === 409) {
      return fail(409, {
        message: 'If you already have an account or a pending application, please sign in or contact us.',
        fullName,
        email
      });
    }
    return fail(400, { message: result.message || 'Something went wrong. Please try again.', fullName, email });
  }
};
