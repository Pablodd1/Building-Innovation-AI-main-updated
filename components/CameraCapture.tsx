import React, { useRef, useState, useEffect } from 'react';
import { Button } from './Button';

interface CameraCaptureProps {
  onImageCapture: (file: File) => void;
  lang?: 'en' | 'es';
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ onImageCapture, lang = 'en' }) => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Effect to attach stream to video element once both exist
  useEffect(() => {
    if (isCameraActive && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [isCameraActive, stream]);

  const startCamera = async () => {
    setIsCameraActive(true);
    setCameraError(null);

    try {
      let mediaStream: MediaStream;
      
      try {
        // Attempt 1: Ultra HD / 4K Resolution
        mediaStream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 3840 },
            height: { ideal: 2160 }
          } 
        });
      } catch (uhdError) {
        try {
           // Attempt 2: Full HD
           mediaStream = await navigator.mediaDevices.getUserMedia({ 
             video: { 
               facingMode: 'environment',
               width: { ideal: 1920 },
               height: { ideal: 1080 }
             } 
           });
        } catch (hdError) {
            console.warn("HD Camera failed, retrying with defaults...", hdError);
            // Attempt 3: Fallback
            mediaStream = await navigator.mediaDevices.getUserMedia({ 
              video: { facingMode: 'environment' } 
            });
        }
      }

      setStream(mediaStream);
    } catch (err: any) {
      console.error("Error accessing camera:", err);
      let msg = lang === 'es' ? "No se pudo acceder a la cámara." : "Could not access camera.";
      
      if (err.name === 'NotAllowedError') {
        msg = lang === 'es' ? "Permiso denegado." : "Camera permission denied.";
      } else if (err.name === 'NotFoundError') {
        msg = lang === 'es' ? "No se encontró cámara." : "No camera device found.";
      } else if (err.name === 'NotReadableError') {
        msg = lang === 'es' ? "La cámara está en uso por otra aplicación." : "Camera is in use by another app.";
      }
      
      setCameraError(`${msg} ${lang === 'es' ? "Intenta subir una foto." : "Please try uploading a file."}`);
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
    setIsCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      // Set canvas dimensions to match video stream (often higher res than screen)
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Draw the image
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to blob/file with high quality
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
            stopCamera(); // Stop stream after capture
            onImageCapture(file);
          }
        }, 'image/jpeg', 0.98);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onImageCapture(e.target.files[0]);
    }
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [stream]);

  const texts = {
    addPhoto: lang === 'es' ? "Añadir Foto" : "Add Photo",
    desc: lang === 'es' ? "Sube una foto existente o toma una nueva." : "Upload an existing photo or take a new one using your camera.",
    upload: lang === 'es' ? "Cámara Nativa / Galería" : "Native Camera / Gallery",
    webcam: lang === 'es' ? "Cámara Web (Preview)" : "Webcam (Live Preview)",
    cancel: lang === 'es' ? "Cancelar" : "Cancel",
    capture: lang === 'es' ? "Capturar" : "Capture",
    recommendation: lang === 'es' ? "Recomendado para mejor calidad" : "Recommended for best quality"
  };

  if (isCameraActive) {
    return (
      <div className="relative w-full h-full min-h-[400px] bg-black rounded-2xl overflow-hidden flex flex-col group">
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline 
          muted
          className="flex-1 w-full h-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />
        
        {/* Composition Grid Overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-30 group-hover:opacity-50 transition-opacity">
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/50 shadow-sm"></div>
            <div className="absolute right-1/3 top-0 bottom-0 w-px bg-white/50 shadow-sm"></div>
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/50 shadow-sm"></div>
            <div className="absolute bottom-1/3 left-0 right-0 h-px bg-white/50 shadow-sm"></div>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent flex justify-center gap-4 z-10">
          <Button 
            variant="secondary" 
            onClick={stopCamera}
          >
            {texts.cancel}
          </Button>
          <Button 
            onClick={capturePhoto}
            className="bg-white text-black hover:bg-slate-200"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            }
          >
            {texts.capture}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[400px] border-2 border-dashed border-slate-700 rounded-2xl bg-slate-800/30 p-8 transition-all">
      <div className="text-center space-y-6 max-w-md w-full">
        
        <div className="space-y-2">
           <h2 className="text-2xl font-bold text-white">{texts.addPhoto}</h2>
           <p className="text-slate-400 text-sm">
            {texts.desc}
          </p>
        </div>

        {cameraError && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg text-sm">
            {cameraError}
          </div>
        )}

        <div className="grid gap-4 w-full">
          <input 
            type="file" 
            accept="image/*" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileChange}
          />
          
          {/* Native File/Camera Input (Optimized for Mobile) */}
          <div className="relative group">
            <Button 
                variant="primary"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 shadow-xl shadow-blue-900/20"
                icon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                }
            >
                {texts.upload}
            </Button>
            <div className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg animate-bounce">
               4K / HDR
            </div>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider font-bold mt-2">{texts.recommendation}</p>
          </div>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-slate-700"></div>
            <span className="flex-shrink-0 mx-4 text-slate-600 text-xs font-bold uppercase">Or</span>
            <div className="flex-grow border-t border-slate-700"></div>
          </div>

          {/* Live Webcam (Browser Stream) */}
          <Button 
            variant="secondary"
            onClick={startCamera}
            className="w-full py-4 border-slate-700 bg-slate-800/50 hover:bg-slate-800"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            }
          >
            {texts.webcam}
          </Button>
        </div>
      </div>
    </div>
  );
};