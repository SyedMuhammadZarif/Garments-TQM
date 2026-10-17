import { useEffect, useState } from 'react';
import type { HealthStatus } from '@tqm/shared';
import { meta } from '../data/dataSource';
import { translate as t } from '../i18n';

type State = { kind: 'loading' } | { kind: 'ok'; health: HealthStatus } | { kind: 'error' };

export function HelloPage() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    meta
      .health(controller.signal)
      .then((health) => setState({ kind: 'ok', health }))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, []);

  const apiOk = state.kind === 'ok';
  const dbOk = state.kind === 'ok' && state.health.db === 'ok';

  return (
    <main className="min-h-dvh flex items-center justify-center p-4">
      <section className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center gap-3">
          <img src="/icons/logo.svg" alt="" width={40} height={40} />
          <span className="text-lg font-semibold text-navy-900">{t('app.name')}</span>
        </div>
        <h1 className="mt-8 text-3xl font-bold text-navy-900">{t('hello.title')}</h1>
        <p className="mt-1 text-gray-600">{t('hello.subtitle')}</p>
        <dl className="mt-6 space-y-3">
          <StatusRow
            label={t('hello.api')}
            loading={state.kind === 'loading'}
            ok={apiOk}
            text={
              state.kind === 'loading' ? t('hello.checking') : apiOk ? t('hello.ok') : t('hello.unreachable')
            }
          />
          <StatusRow
            label={t('hello.database')}
            loading={state.kind === 'loading'}
            ok={dbOk}
            text={state.kind === 'loading' ? t('hello.checking') : dbOk ? t('hello.ok') : t('hello.down')}
          />
        </dl>
      </section>
    </main>
  );
}

function StatusRow({
  label,
  loading,
  ok,
  text,
}: {
  label: string;
  loading: boolean;
  ok: boolean;
  text: string;
}) {
  const tone = loading ? 'bg-gray-100 text-gray-600' : ok ? 'bg-ok-50 text-ok-500' : 'bg-bad-50 text-bad-500';
  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
      <dt className="font-medium text-gray-700">{label}</dt>
      <dd className={`rounded-full px-3 py-1 text-sm font-medium ${tone}`}>
        <span aria-hidden="true">{loading ? '…' : ok ? '✓ ' : '✕ '}</span>
        {text}
      </dd>
    </div>
  );
}
