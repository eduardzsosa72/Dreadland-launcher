import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import { loadMinecraftNews } from '../lib/minecraftNews';

const DEFAULT_SOURCE = 'https://www.minecraft.net/en-us/articles';

// Minecraft news feed (loaded once on start) and the selected article.
export function useNews({ t }) {
  const [newsItems, setNewsItems] = useState([]);
  const [newsSourceUrl, setNewsSourceUrl] = useState(DEFAULT_SOURCE);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState('');
  const [selectedArticle, setSelectedArticle] = useState(null);

  // Translations only affect error text, so a language change must not refetch the feed
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);

  const loadNews = useCallback(async () => {
    setNewsLoading(true);
    setNewsError('');
    try {
      let payload = await api.news.list({ limit: 60 }).catch(() => null);
      // Direct fetch as a last resort (works in browser dev mode, may be blocked in the app)
      if (!payload?.items?.length) payload = await loadMinecraftNews({ limit: 60 });

      if (!payload) {
        setNewsError(tRef.current('news.errorNoNewsFound'));
        return;
      }
      if (payload.error && !payload.items?.length) {
        setNewsError(payload.error);
        return;
      }
      if (Array.isArray(payload)) {
        setNewsItems(payload);
        return;
      }
      setNewsItems(Array.isArray(payload.items) ? payload.items : []);
      if (payload.sourceUrl) setNewsSourceUrl(payload.sourceUrl);
    } catch (error) {
      setNewsError(error?.message || tRef.current('news.errorNoNewsFound'));
    } finally {
      setNewsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNews();
  }, [loadNews]);

  const handleOpenNewsSource = () => {
    api.system.openExternal(newsSourceUrl).catch(() => { });
  };

  const handleOpenNewsArticle = (item) => {
    if (typeof item === 'string') {
      setSelectedArticle(newsItems.find(n => n.url === item) || { url: item, title: 'Minecraft News' });
    } else {
      setSelectedArticle(item);
    }
  };

  return {
    newsItems, newsLoading, newsError, loadNews,
    selectedArticle, setSelectedArticle,
    handleOpenNewsSource, handleOpenNewsArticle,
  };
}
