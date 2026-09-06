import React, { useState, useEffect, useCallback } from 'react';

interface Purchase {
    id: string;
    userId?: string;
    userName?: string;
    userEmail?: string;
    materialName?: string;
    quantity?: number;
    status?: string;
    createdAt?: string;
    totalPrice?: number;
}

/**
 * Self-contained Admin Purchase Queue component.
 * Fetches its own data from /api/purchase-requests and handles
 * approve/reject actions internally — no props required.
 */
export const AdminPurchaseQueue: React.FC = () => {
    const [purchases, setPurchases] = useState<Purchase[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    const fetchPurchases = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const res = await fetch('/api/purchase-requests');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setPurchases(Array.isArray(data) ? data : (data.purchases || []));
        } catch (e: any) {
            setError(e.message || 'Failed to load purchases');
            setPurchases([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchPurchases();
    }, [fetchPurchases]);

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        setActionLoading(id);
        try {
            const res = await fetch(`/api/purchase-requests/${id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            // Refresh list after action
            await fetchPurchases();
        } catch (e: any) {
            setError(`Failed to ${action}: ${e.message}`);
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="bg-white rounded-xl p-6 shadow-sm border border-gray-200 text-center">
                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p className="text-sm text-gray-500">Loading purchases...</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
            <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-800">Purchase Queue</h3>
                <button
                    onClick={fetchPurchases}
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                >
                    Refresh
                </button>
            </div>

            {error && (
                <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                    {error}
                </div>
            )}

            {purchases.length === 0 ? (
                <p className="text-sm text-gray-500">No purchases pending.</p>
            ) : (
                <div className="space-y-3">
                    {purchases.map((p) => (
                        <div key={p.id} className="flex justify-between items-center border-b pb-2">
                            <div>
                                <p className="text-sm font-medium">{p.userName || p.userEmail || 'Unknown'}</p>
                                <p className="text-xs text-gray-500">
                                    {p.materialName} x{p.quantity}
                                    {p.totalPrice != null && ` · $${p.totalPrice}`}
                                </p>
                                {p.status && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                        p.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                        p.status === 'approved' ? 'bg-green-100 text-green-700' :
                                        'bg-red-100 text-red-700'
                                    }`}>
                                        {p.status}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleAction(p.id, 'approve')}
                                    disabled={actionLoading === p.id}
                                    className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full hover:bg-green-200 disabled:opacity-50"
                                >
                                    {actionLoading === p.id ? '...' : 'Approve'}
                                </button>
                                <button
                                    onClick={() => handleAction(p.id, 'reject')}
                                    disabled={actionLoading === p.id}
                                    className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full hover:bg-red-200 disabled:opacity-50"
                                >
                                    {actionLoading === p.id ? '...' : 'Reject'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
