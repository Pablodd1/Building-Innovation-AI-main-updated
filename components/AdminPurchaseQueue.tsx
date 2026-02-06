// Admin Purchase Queue Component
// View and manage all purchase requests

import React, { useState, useEffect } from "react";
import { Button } from "./Button";

interface PurchaseRequest {
    id: number;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    customer_address: string;
    cart_items: Array<{
        materialId: string;
        materialName: string;
        quantity: number;
        unitCost: number;
    }>;
    total_estimate: number;
    currency: string;
    project_notes: string | null;
    room_image_url: string | null;
    status: "pending" | "contacted" | "quote_sent" | "completed" | "cancelled";
    created_at: string;
    contacted_at: string | null;
}

export const AdminPurchaseQueue: React.FC = () => {
    const [requests, setRequests] = useState<PurchaseRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<string>("all");
    const [selectedRequest, setSelectedRequest] =
        useState<PurchaseRequest | null>(null);

    useEffect(() => {
        fetchRequests();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchRequests, 30000);
        return () => clearInterval(interval);
    }, [filter]);

    const fetchRequests = async () => {
        try {
            const url =
                filter === "all"
                    ? "/api/purchase-requests"
                    : `/api/purchase-requests?status=${filter}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error("Failed to fetch requests");

            const data = await response.json();
            setRequests(data);
        } catch (error) {
            console.error("Failed to fetch purchase requests:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (id: number, newStatus: string) => {
        try {
            const response = await fetch(`/api/purchase-requests/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
            });

            if (!response.ok) throw new Error("Failed to update status");

            await fetchRequests(); // Refresh list
            if (selectedRequest?.id === id) {
                setSelectedRequest(null);
            }
        } catch (error) {
            console.error("Failed to update status:", error);
            alert("Failed to update status");
        }
    };

    const getStatusColor = (status: string) => {
        const colors = {
            pending: "bg-yellow-100 text-yellow-800 border-yellow-200",
            contacted: "bg-blue-100 text-blue-800 border-blue-200",
            quote_sent: "bg-purple-100 text-purple-800 border-purple-200",
            completed: "bg-green-100 text-green-800 border-green-200",
            cancelled: "bg-gray-100 text-gray-800 border-gray-200",
        };
        return colors[status as keyof typeof colors] || colors.pending;
    };

    const filteredRequests = requests;

    if (loading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
            </div>
        );
    }

    return (
        <div className="p-6">
            {/* Header */}
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                        Purchase Requests
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        {requests.length} total request
                        {requests.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <button
                    onClick={fetchRequests}
                    className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
                >
                    <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                        />
                    </svg>
                    Refresh
                </button>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 mb-6 border-b border-gray-200">
                {["all", "pending", "contacted", "quote_sent", "completed"].map(
                    (status) => (
                        <button
                            key={status}
                            onClick={() => setFilter(status)}
                            className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                                filter === status
                                    ? "border-blue-600 text-blue-600"
                                    : "border-transparent text-gray-500 hover:text-gray-700"
                            }`}
                        >
                            {status.charAt(0).toUpperCase() +
                                status.slice(1).replace("_", " ")}
                            {status === "all" && ` (${requests.length})`}
                            {status !== "all" &&
                                ` (${requests.filter((r) => r.status === status).length})`}
                        </button>
                    ),
                )}
            </div>

            {/* Requests List */}
            {filteredRequests.length === 0 ? (
                <div className="text-center py-12 bg-gray-50 rounded-xl">
                    <svg
                        className="w-16 h-16 text-gray-400 mx-auto mb-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                    </svg>
                    <p className="text-gray-600 font-medium">
                        No requests found
                    </p>
                    <p className="text-sm text-gray-500 mt-1">
                        New requests will appear here
                    </p>
                </div>
            ) : (
                <div className="grid gap-4">
                    {filteredRequests.map((request) => (
                        <div
                            key={request.id}
                            className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md transition-shadow cursor-pointer"
                            onClick={() => setSelectedRequest(request)}
                        >
                            <div className="flex justify-between items-start mb-4">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                        <h3 className="text-lg font-bold text-gray-900">
                                            {request.customer_name}
                                        </h3>
                                        <span
                                            className={`px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(request.status)}`}
                                        >
                                            {request.status
                                                .replace("_", " ")
                                                .toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="space-y-1 text-sm text-gray-600">
                                        <div className="flex items-center gap-2">
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                                                />
                                            </svg>
                                            {request.customer_email}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                                                />
                                            </svg>
                                            <a
                                                href={`tel:${request.customer_phone}`}
                                                className="text-blue-600 hover:underline font-medium"
                                            >
                                                {request.customer_phone}
                                            </a>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <svg
                                                className="w-4 h-4"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                                />
                                            </svg>
                                            {new Date(
                                                request.created_at,
                                            ).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-2xl font-bold text-blue-600 mb-1">
                                        ${request.total_estimate.toFixed(2)}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                        {request.currency}
                                    </div>
                                </div>
                            </div>

                            {/* Cart Items Summary */}
                            <div className="bg-gray-50 rounded-lg p-3 mb-3">
                                <p className="text-xs font-medium text-gray-700 mb-2">
                                    Materials ({request.cart_items.length}{" "}
                                    items):
                                </p>
                                <div className="space-y-1">
                                    {request.cart_items
                                        .slice(0, 3)
                                        .map((item, idx) => (
                                            <div
                                                key={idx}
                                                className="text-xs text-gray-600 flex justify-between"
                                            >
                                                <span>
                                                    {item.materialName} ×{" "}
                                                    {item.quantity}
                                                </span>
                                                <span className="font-medium">
                                                    $
                                                    {(
                                                        item.unitCost *
                                                        item.quantity
                                                    ).toFixed(2)}
                                                </span>
                                            </div>
                                        ))}
                                    {request.cart_items.length > 3 && (
                                        <p className="text-xs text-gray-500 italic">
                                            +{request.cart_items.length - 3}{" "}
                                            more...
                                        </p>
                                    )}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2">
                                {request.status === "pending" && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleStatusChange(
                                                request.id,
                                                "contacted",
                                            );
                                        }}
                                        className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                                    >
                                        ✓ Mark as Contacted
                                    </button>
                                )}
                                {request.status === "contacted" && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleStatusChange(
                                                request.id,
                                                "quote_sent",
                                            );
                                        }}
                                        className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium"
                                    >
                                        📧 Quote Sent
                                    </button>
                                )}
                                {(request.status === "quote_sent" ||
                                    request.status === "contacted") && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleStatusChange(
                                                request.id,
                                                "completed",
                                            );
                                        }}
                                        className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
                                    >
                                        ✓ Complete
                                    </button>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedRequest(request);
                                    }}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                                >
                                    Details
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Detail Modal */}
            {selectedRequest && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <h3 className="text-2xl font-bold text-gray-900">
                                    Request #{selectedRequest.id}
                                </h3>
                                <p className="text-sm text-gray-500">
                                    {new Date(
                                        selectedRequest.created_at,
                                    ).toLocaleString()}
                                </p>
                            </div>
                            <button
                                onClick={() => setSelectedRequest(null)}
                                className="text-gray-400 hover:text-gray-600"
                            >
                                <svg
                                    className="w-6 h-6"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M6 18L18 6M6 6l12 12"
                                    />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-6">
                            {/* Customer Info */}
                            <div>
                                <h4 className="font-semibold text-gray-900 mb-3">
                                    Customer Information
                                </h4>
                                <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg">
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">
                                            Name
                                        </p>
                                        <p className="font-medium">
                                            {selectedRequest.customer_name}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">
                                            Email
                                        </p>
                                        <a
                                            href={`mailto:${selectedRequest.customer_email}`}
                                            className="font-medium text-blue-600 hover:underline"
                                        >
                                            {selectedRequest.customer_email}
                                        </a>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">
                                            Phone
                                        </p>
                                        <a
                                            href={`tel:${selectedRequest.customer_phone}`}
                                            className="font-medium text-blue-600 hover:underline"
                                        >
                                            {selectedRequest.customer_phone}
                                        </a>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">
                                            Address
                                        </p>
                                        <p className="font-medium">
                                            {selectedRequest.customer_address}
                                        </p>
                                    </div>
                                    <div>
                                        <p className="text-xs text-gray-500 mb-1">
                                            Status
                                        </p>
                                        <span
                                            className={`inline-block px-3 py-1 rounded-full text-xs font-medium border ${getStatusColor(selectedRequest.status)}`}
                                        >
                                            {selectedRequest.status
                                                .replace("_", " ")
                                                .toUpperCase()}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Materials */}
                            <div>
                                <h4 className="font-semibold text-gray-900 mb-3">
                                    Requested Materials
                                </h4>
                                <div className="space-y-2">
                                    {selectedRequest.cart_items.map(
                                        (item, idx) => (
                                            <div
                                                key={idx}
                                                className="flex justify-between items-center bg-gray-50 p-3 rounded-lg"
                                            >
                                                <div>
                                                    <p className="font-medium text-gray-900">
                                                        {item.materialName}
                                                    </p>
                                                    <p className="text-sm text-gray-500">
                                                        Quantity:{" "}
                                                        {item.quantity}
                                                    </p>
                                                </div>
                                                <div className="text-right">
                                                    <p className="font-bold text-gray-900">
                                                        $
                                                        {(
                                                            item.unitCost *
                                                            item.quantity
                                                        ).toFixed(2)}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        $
                                                        {item.unitCost.toFixed(
                                                            2,
                                                        )}{" "}
                                                        each
                                                    </p>
                                                </div>
                                            </div>
                                        ),
                                    )}
                                </div>
                                <div className="mt-4 pt-4 border-t border-gray-200">
                                    <div className="flex justify-between items-center">
                                        <p className="text-lg font-bold text-gray-900">
                                            Total Estimate
                                        </p>
                                        <p className="text-2xl font-bold text-blue-600">
                                            $
                                            {selectedRequest.total_estimate.toFixed(
                                                2,
                                            )}{" "}
                                            {selectedRequest.currency}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Project Notes */}
                            {selectedRequest.project_notes && (
                                <div>
                                    <h4 className="font-semibold text-gray-900 mb-3">
                                        Project Notes
                                    </h4>
                                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                        <p className="text-gray-700">
                                            {selectedRequest.project_notes}
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-4">
                                <select
                                    value={selectedRequest.status}
                                    onChange={(e) => {
                                        handleStatusChange(
                                            selectedRequest.id,
                                            e.target.value,
                                        );
                                    }}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="pending">Pending</option>
                                    <option value="contacted">Contacted</option>
                                    <option value="quote_sent">
                                        Quote Sent
                                    </option>
                                    <option value="completed">Completed</option>
                                    <option value="cancelled">Cancelled</option>
                                </select>
                                <button
                                    onClick={() => setSelectedRequest(null)}
                                    className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                                >
                                    Close
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
