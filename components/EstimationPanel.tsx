import React from 'react';

interface EstimationPanelProps {
    materialName?: string;
    quantity?: number;
    unitPrice?: number;
}

export const EstimationPanel: React.FC<EstimationPanelProps> = ({ materialName, quantity, unitPrice }) => {
    const total = (quantity || 0) * (unitPrice || 0);
    return (
        <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
            <h3 className="font-semibold text-gray-800 mb-3">Estimation</h3>
            <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                    <span className="text-gray-600">Material</span>
                    <span className="font-medium">{materialName || '—'}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-600">Quantity</span>
                    <span className="font-medium">{quantity || 0} units</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-gray-600">Unit Price</span>
                    <span className="font-medium">${(unitPrice || 0).toFixed(2)}</span>
                </div>
                <hr />
                <div className="flex justify-between text-base font-bold">
                    <span className="text-gray-800">Total</span>
                    <span className="text-blue-600">${total.toFixed(2)}</span>
                </div>
            </div>
        </div>
    );
};
