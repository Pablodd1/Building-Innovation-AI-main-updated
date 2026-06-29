import React from 'react';

interface Purchase {
    id: string;
    userId?: string;
    userName?: string;
    materialName?: string;
    quantity?: number;
    status?: string;
    createdAt?: string;
}

interface AdminPurchaseQueueProps {
    purchases?: Purchase[];
    onApprove?: (id: string) => void;
    onReject?: (id: string) => void;
}

export const AdminPurchaseQueue: React.FC<AdminPurchaseQueueProps> = ({
    purchases = [],
    onApprove,
    onReject,
}) => {
    return (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
            <h3 className="font-semibold text-gray-800 mb-3">Purchase Queue</h3>
            {purchases.length === 0 ? (
                <p className="text-sm text-gray-500">No purchases pending.</p>
            ) : (
                <div className="space-y-3">
                    {purchases.map((p) => (
                        <div key={p.id} className="flex justify-between items-center border-b pb-2">
                            <div>
                                <p className="text-sm font-medium">{p.userName || 'Unknown'}</p>
                                <p className="text-xs text-gray-500">{p.materialName} x{p.quantity}</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => onApprove?.(p.id)}
                                    className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-full"
                                >
                                    Approve
                                </button>
                                <button
                                    onClick={() => onReject?.(p.id)}
                                    className="text-xs bg-red-100 text-red-700 px-3 py-1 rounded-full"
                                >
                                    Reject
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
