globalThis.copastePlugin = {
  query(query, listeners) {
    const filter = query.trim().toLowerCase();
    const numeric = /^\d+$/.test(filter);
    const matching = listeners.filter(listener => {
      if (numeric) {
        return String(listener.pid) === filter || listener.endpoints.some(endpoint => endpoint.endsWith(`:${filter}`));
      }
      return `${listener.name} ${listener.endpoints.join(' ')}`.toLowerCase().includes(filter);
    });

    return matching
      .sort((a, b) => a.pid - b.pid)
      .slice(0, 100)
      .map(({ endpoints, id, name, pid }) => {
        const sockets = endpoints.join(', ');
        const label = sockets.length > 450 ? `${sockets.slice(0, 449)}…` : sockets;
        return { description: `TCP ${label} · PID ${pid}`, id, title: name };
      });
  },
};
