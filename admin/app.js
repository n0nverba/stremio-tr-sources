let state;
const byId = (id) => document.getElementById(id);
const message = (text) => {
  byId('message').textContent = text;
};
async function api(path, body) {
  const response = await fetch(
    `/admin/api/${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': state.csrf,
          },
          body: JSON.stringify(body),
        },
  );
  if (!response.ok) throw new Error(`İstek başarısız (${response.status})`);
  return response.json();
}
async function load() {
  state = await api('state');
  byId('demo-check').disabled = !state.demoPreview;
  byId('install').value = state.installUrl;
  const stremioBtn = byId('stremio-install-btn');
  if (stremioBtn && state.installUrl) {
    stremioBtn.href = state.installUrl.replace(/^https?:\/\//, 'stremio://');
  }
  if (state.installUrl && !state.installUrl.startsWith('https://')) {
    setTimeout(load, 2500);
  }
  checkUpdate();
}
async function checkUpdate() {
  try {
    const update = await api('update/check');
    const statusEl = byId('update-status');
    const detailsEl = byId('update-details');
    const btn = byId('update-btn');
    if (!statusEl) return;

    if (update.offline) {
      statusEl.textContent = 'Mevcut Sürüm: ' + update.localSha;
      statusEl.style.color = '#94a3b8';
      detailsEl.textContent = 'GitHub sunucusuna ulaşılamadı (çevrimdışı).';
    } else if (update.updateAvailable) {
      statusEl.textContent = '🎉 Yeni bir güncelleme mevcut! (' + update.remoteSha + ')';
      statusEl.style.color = '#34d399';
      detailsEl.textContent = update.message;
      btn.style.display = 'inline-block';
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Güncelleniyor…';
        try {
          const res = await api('update/apply', {});
          if (res.success) {
            alert('Güncelleme başarıyla tamamlandı! Servis yeniden başlatılıyor...');
            location.reload();
          } else {
            alert('Güncelleme hatası: ' + res.output);
            btn.disabled = false;
            btn.textContent = 'Tekrar Dene';
          }
        } catch (e) {
          alert('Güncelleme hatası: ' + e.message);
          btn.disabled = false;
          btn.textContent = 'Tekrar Dene';
        }
      };
    } else {
      statusEl.textContent = '✅ En son sürümü kullanıyorsunuz (' + update.localSha + ')';
      statusEl.style.color = '#38bdf8';
      detailsEl.textContent = 'Son değişiklik: ' + update.message;
      btn.style.display = 'none';
    }
  } catch (err) {}
}
  byId('language').value = state.settings.language;
  byId('quality').value = state.settings.quality;
  byId('timeout').value = state.settings.providerTimeoutMs;
  byId('threshold').value = state.settings.matchThreshold;
  byId('providers').replaceChildren(
    ...state.providers.map((provider) => {
      const label = document.createElement('label');
      label.className = 'provider';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = provider.enabled;
      input.dataset.providerId = provider.id;
      const text = document.createElement('span');
      text.textContent =
        provider.name +
        (provider.catalogOnly ? ' · Katalog (oynatma desteklenmiyor)' : '');
      label.append(input, text);
      return label;
    }),
  );
  byId('cache').textContent =
    `${state.cache.size} / ${state.cache.maxEntries} kayıt · ${state.cache.hits} cache hit · ${state.cache.misses} miss`;
  byId('unsupported-sources').replaceChildren(
    ...(state.unsupportedSources ?? []).map((source) => {
      const row = document.createElement('div');
      row.className = 'health-row';
      row.textContent = `${source.name} · Oynatım entegrasyonu tamamlanmadı`;
      const detail = document.createElement('small');
      detail.textContent = source.reason;
      row.append(detail);
      return row;
    }),
  );
  byId('errors').replaceChildren(
    ...state.errors.map((error) => {
      const item = document.createElement('li');
      item.textContent = `${error.time} · ${error.providerId} · ${error.code}`;
      return item;
    }),
  );
}
async function action(button, work) {
  button.disabled = true;
  try {
    await work();
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
}
byId('settings').addEventListener('submit', (event) => {
  event.preventDefault();
  action(event.submitter, async () => {
    const providers = Object.fromEntries(
      [...document.querySelectorAll('[data-provider-id]')].map((input) => [
        input.dataset.providerId,
        input.checked,
      ]),
    );
    await api('settings', {
      providers,
      language: byId('language').value,
      quality: byId('quality').value,
      providerTimeoutMs: Number(byId('timeout').value),
      matchThreshold: Number(byId('threshold').value),
    });
    await load();
    message('Tercihler kaydedildi.');
  });
});
byId('clear').addEventListener('click', (event) =>
  action(event.target, async () => {
    await api('cache/clear', {});
    await load();
    message('Önbellek temizlendi.');
  }),
);
byId('copy').addEventListener('click', (event) =>
  action(event.target, async () => {
    await navigator.clipboard.writeText(state.installUrl);
    message('Eklenti kurulum adresi kopyalandı.');
  }),
);
byId('health').addEventListener('click', (event) =>
  action(event.target, async () => {
    const rows = await api('health');
    const names = Object.fromEntries(
      state.providers.map((p) => [p.id, p.name]),
    );
    const labels = {
      healthy: 'Erişilebilir',
      degraded: 'Erişim sorunu',
      disabled: 'Kapalı',
      unsupported: 'Desteklenmiyor',
    };
    byId('health-results').replaceChildren(
      ...rows.map((row) => {
        const div = document.createElement('div');
        div.className = 'health-row';
        div.textContent = `${row.name || names[row.id] || row.id} · ${labels[row.status] || row.status}${row.latencyMs !== undefined ? ` · ${row.latencyMs} ms` : ''}`;
        const detail = document.createElement('small');
        detail.textContent = row.reason || row.error || row.lastChecked || '';
        div.append(detail);
        return div;
      }),
    );
    message('Kaynak durumları güncellendi.');
  }),
);
load().catch((error) => message(error.message));
byId('demo-check').addEventListener('click', (event) =>
  action(event.target, async () => {
    const video = byId('demo-video');
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.hidden = true;
    const status = byId('demo-status');
    status.textContent = 'Sağlayıcı ve medya bağlantısı kontrol ediliyor…';
    try {
      const response = await fetch(
        `/stream/movie/${state.demoPreview.imdbId}.json`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      const stream = result.streams?.find(
        (item) => item.url === state.demoPreview.mediaUrl,
      );
      if (!stream) {
        status.textContent =
          'Demo stream dönmedi. Blender sağlayıcısının açık olduğunu, dil tercihinin Hepsi olduğunu ve kaynak durumunu kontrol edin.';
        return;
      }
      video.src = stream.url;
      video.hidden = false;
      status.textContent =
        'Stream doğrulandı. Görüntü ve sesi kontrol etmek için oynat düğmesine basın.';
    } catch (error) {
      status.textContent =
        'Stream kontrolü tamamlanamadı. Sunucu bağlantısını kontrol edin.';
      throw error;
    }
  }),
);
byId('demo-video').addEventListener('playing', () => {
  byId('demo-status').textContent =
    'Tarayıcı oynatımı başladı. Stremio oynatımını ayrıca uygulamada kontrol edin.';
});
byId('demo-video').addEventListener('error', () => {
  byId('demo-status').textContent =
    'Stream bulundu ancak tarayıcı medyayı oynatamadı. Kaynağa erişimi ve kaynak durumunu kontrol edin.';
});
