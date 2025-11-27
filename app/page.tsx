"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Camera, TrendingUp, FileText, Edit2, Loader2, AlertCircle } from "lucide-react"
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// API 응답 타입
interface OCRResponse {
  isRelevant: boolean
  boxCount: number | null
  bottleCount: number | null
  bpm: number | null
  status: "normal" | "slow" | "unknown"
  summary: string
  rawText: string
  error?: string
  message?: string
}

type LogEntry = {
  id: string
  timestamp: Date
  boxes: number
  bottles: number
  bpm: number
  status: "정상" | "느림" | "알수없음"
  imageUrl?: string
  summary?: string
  isRelevant: boolean
}

type Tab = "dashboard" | "logs" | "settings"

const formatKST = (date: Date, formatString: string) => {
  const kstDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Seoul" }))

  const year = kstDate.getFullYear()
  const month = kstDate.getMonth() + 1
  const day = kstDate.getDate()
  const hours = kstDate.getHours()
  const minutes = kstDate.getMinutes()
  const seconds = kstDate.getSeconds()

  const pad = (n: number) => n.toString().padStart(2, "0")

  switch (formatString) {
    case "HH:mm":
      return `${pad(hours)}:${pad(minutes)}`
    case "HH:mm:ss":
      return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    case "M월 d일, HH:mm:ss":
      return `${month}월 ${day}일, ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    case "yyyy-MM-dd HH:mm:ss":
      return `${year}-${pad(month)}-${pad(day)} ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    default:
      return kstDate.toLocaleString("ko-KR")
  }
}

export default function ProductionTrackerApp() {
  const [selectedLine, setSelectedLine] = useState("A 라인")
  const [activeTab, setActiveTab] = useState<Tab>("dashboard")
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [editingLog, setEditingLog] = useState<LogEntry | null>(null)
  const [editValue, setEditValue] = useState("")
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [showTimeInputDialog, setShowTimeInputDialog] = useState(false)
  const [photoTime, setPhotoTime] = useState("")
  const [photoDate, setPhotoDate] = useState("")
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [lastIrrelevantSummary, setLastIrrelevantSummary] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 관련 있는 로그만 필터링
  const relevantLogs = logs.filter(log => log.isRelevant)
  const latestLog = relevantLogs[relevantLogs.length - 1]
  const currentBpm = latestLog?.bpm || 0
  const totalBoxes = latestLog?.boxes || 0
  const totalBottles = latestLog?.bottles || 0
  const lastScanTime = latestLog?.timestamp

  const getTimeSinceLastScan = () => {
    if (!lastScanTime) return "기록 없음"
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
    const lastScan = new Date(lastScanTime.toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
    const minutes = Math.floor((now.getTime() - lastScan.getTime()) / 60000)
    if (minutes === 0) return "방금 전"
    if (minutes === 1) return "1분 전"
    return `${minutes}분 전`
  }

  const getStatusText = (status: "normal" | "slow" | "unknown" | "정상" | "느림" | "알수없음"): "정상" | "느림" | "알수없음" => {
    if (status === "normal" || status === "정상") return "정상"
    if (status === "slow" || status === "느림") return "느림"
    return "알수없음"
  }

  const handleCameraScan = () => {
    fileInputRef.current?.click()
  }

  const handleImageCapture = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement("canvas")
        const ctx = canvas.getContext("2d")

        const maxSize = 1200
        let width = img.width
        let height = img.height

        if (width > height && width > maxSize) {
          height = (height * maxSize) / width
          width = maxSize
        } else if (height > maxSize) {
          width = (width * maxSize) / height
          height = maxSize
        }

        canvas.width = width
        canvas.height = height

        ctx?.drawImage(img, 0, 0, width, height)

        const compressedImage = canvas.toDataURL("image/jpeg", 0.85)
        console.log("[클라이언트] 원본 크기:", (e.target?.result as string).length, "압축 후:", compressedImage.length)

        setCapturedImage(compressedImage)
        setOcrError(null)
        setLastIrrelevantSummary(null)

        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }))
        const year = now.getFullYear()
        const month = String(now.getMonth() + 1).padStart(2, "0")
        const day = String(now.getDate()).padStart(2, "0")
        const hours = String(now.getHours()).padStart(2, "0")
        const minutes = String(now.getMinutes()).padStart(2, "0")

        setPhotoDate(`${year}-${month}-${day}`)
        setPhotoTime(`${hours}:${minutes}`)
        setShowTimeInputDialog(true)
      }

      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)

    event.target.value = ""
  }

  const analyzeImage = async (base64Image: string): Promise<OCRResponse> => {
    try {
      console.log("[클라이언트] OCR API 호출 시작")

      // 이전 데이터 준비 (BPM 계산용)
      const previousLog = relevantLogs[relevantLogs.length - 1]
      const requestBody: any = { image: base64Image }

      if (previousLog) {
        requestBody.previousBottleCount = previousLog.bottles
        requestBody.previousTimestamp = previousLog.timestamp.getTime()
      }

      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      })

      console.log("[클라이언트] API 응답 상태:", response.status)

      if (!response.ok) {
        const data = await response.json()
        console.error("[클라이언트] API 오류 응답:", data)

        if (data.error === "API_KEY_MISSING") {
          throw new Error("API 키가 설정되지 않았습니다. Vars 섹션에서 GEMINI_API_KEY를 추가해주세요.")
        } else if (data.error === "API_KEY_INVALID") {
          throw new Error("API 키가 유효하지 않습니다. 올바른 GEMINI_API_KEY를 설정해주세요.")
        } else if (data.error === "QUOTA_EXCEEDED") {
          throw new Error("API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.")
        } else if (data.error === "SAFETY_BLOCKED") {
          throw new Error("이미지가 안전 필터에 의해 차단되었습니다. 다른 이미지를 사용해주세요.")
        } else {
          throw new Error(data.message || "API 처리 중 오류가 발생했습니다.")
        }
      }

      const data: OCRResponse = await response.json()
      console.log("[클라이언트] API 성공 응답:", data)

      if (data.error) {
        throw new Error(data.message || "이미지 분석에 실패했습니다.")
      }

      return data
    } catch (error) {
      console.error("[클라이언트] analyzeImage 에러:", error)
      throw error
    }
  }

  const handleEditLog = (log: LogEntry) => {
    setEditingLog(log)
    setEditValue(log.boxes.toString())
  }

  const handleSaveEdit = () => {
    if (!editingLog) return

    const newBoxes = Number.parseInt(editValue)
    if (isNaN(newBoxes) || newBoxes < 0) return

    const newBottles = newBoxes * 100

    setLogs((prev) =>
      prev.map((log) => {
        if (log.id === editingLog.id) {
          const relevantLogsBeforeThis = prev.filter(l => l.isRelevant && l.timestamp < log.timestamp)
          let newBpm = log.bpm

          if (relevantLogsBeforeThis.length > 0) {
            const previousLog = relevantLogsBeforeThis[relevantLogsBeforeThis.length - 1]
            const timeDiffMinutes = (log.timestamp.getTime() - previousLog.timestamp.getTime()) / 60000
            const bottlesDiff = newBottles - previousLog.bottles

            if (timeDiffMinutes > 0) {
              newBpm = Math.round(bottlesDiff / timeDiffMinutes)
            }
          }

          return {
            ...log,
            boxes: newBoxes,
            bottles: newBottles,
            bpm: Math.max(0, newBpm),
            status: newBpm >= 50 ? "정상" : "느림",
          }
        }
        return log
      }),
    )

    setEditingLog(null)
    setEditValue("")
  }

  const handleConfirmPhotoTime = async () => {
    if (!capturedImage || !photoTime || !photoDate) return

    console.log("[v0] 사진 시간 확인 완료:", { photoDate, photoTime })

    setShowTimeInputDialog(false)
    setIsScanning(true)
    setOcrError(null)
    setLastIrrelevantSummary(null)

    try {
      console.log("[v0] 이미지 분석 시작")
      const result = await analyzeImage(capturedImage)

      const [year, month, day] = photoDate.split("-").map(Number)
      const [hours, minutes] = photoTime.split(":").map(Number)
      const timestamp = new Date(year, month - 1, day, hours, minutes, 0)

      // 관련 없는 이미지인 경우
      if (!result.isRelevant) {
        console.log("[v0] 관련 없는 이미지:", result.summary)
        setLastIrrelevantSummary(result.summary)

        const newLog: LogEntry = {
          id: Date.now().toString(),
          timestamp,
          boxes: 0,
          bottles: 0,
          bpm: 0,
          status: "알수없음",
          imageUrl: capturedImage,
          summary: result.summary,
          isRelevant: false,
        }

        setLogs((prev) => [...prev, newLog])
        setIsScanning(false)
        setCapturedImage(null)
        setPhotoTime("")
        setPhotoDate("")
        return
      }

      // 관련 있는 이미지인 경우
      const boxes = result.boxCount || 0
      const bottles = result.bottleCount || boxes * 100

      // BPM 계산 (API에서 계산된 값 사용, 없으면 직접 계산)
      let bpm = result.bpm || 0
      if (bpm === 0 && relevantLogs.length > 0) {
        const previousLog = relevantLogs[relevantLogs.length - 1]
        const timeDiffMinutes = (timestamp.getTime() - previousLog.timestamp.getTime()) / 60000
        const bottlesDiff = bottles - previousLog.bottles

        if (timeDiffMinutes > 0 && bottlesDiff > 0) {
          bpm = Math.round(bottlesDiff / timeDiffMinutes)
        }
      }

      const status = getStatusText(result.status || (bpm >= 50 ? "normal" : "slow"))

      console.log("[v0] 기록 생성 - 박스:", boxes, "병:", bottles, "BPM:", bpm, "상태:", status)

      const newLog: LogEntry = {
        id: Date.now().toString(),
        timestamp,
        boxes,
        bottles,
        bpm: Math.max(0, bpm),
        status,
        imageUrl: capturedImage,
        summary: result.summary,
        isRelevant: true,
      }

      console.log("[v0] 새 기록 추가:", newLog)

      setLogs((prev) => [...prev, newLog])
      setIsScanning(false)
      setCapturedImage(null)
      setPhotoTime("")
      setPhotoDate("")

      console.log("[v0] 기록 저장 완료")
    } catch (error) {
      console.error("[v0] 분석 에러:", error)
      setOcrError(error instanceof Error ? error.message : "이미지 처리 중 오류가 발생했습니다.")
      setIsScanning(false)
      setCapturedImage(null)
    }
  }

  const chartData = relevantLogs.slice(-10).map((log) => ({
    time: formatKST(log.timestamp, "HH:mm"),
    boxes: log.boxes,
    bottles: log.bottles,
    bpm: log.bpm,
  }))

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="bg-blue-600 text-white p-4 shadow-md">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold">생산량 실시간 추적</h1>
          <Select value={selectedLine} onValueChange={setSelectedLine}>
            <SelectTrigger className="w-32 bg-blue-500 border-blue-400 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="A 라인">A 라인</SelectItem>
              <SelectItem value="B 라인">B 라인</SelectItem>
              <SelectItem value="C 라인">C 라인</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="bg-blue-500 rounded-lg p-3">
            <div className="text-sm opacity-90">박스</div>
            <div className="text-2xl font-bold">{totalBoxes.toLocaleString()}</div>
          </div>
          <div className="bg-blue-500 rounded-lg p-3">
            <div className="text-sm opacity-90">병</div>
            <div className="text-2xl font-bold">{totalBottles.toLocaleString()}</div>
          </div>
          <div className="bg-blue-500 rounded-lg p-3">
            <div className="text-sm opacity-90">BPM</div>
            <div className="text-2xl font-bold">{currentBpm}</div>
          </div>
        </div>

        {latestLog && (
          <div className="mt-2 text-center">
            <span className={`inline-block px-3 py-1 rounded-full text-sm ${
              latestLog.status === "정상" ? "bg-green-500" :
              latestLog.status === "느림" ? "bg-orange-500" : "bg-gray-500"
            }`}>
              상태: {latestLog.status}
            </span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {ocrError && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded dark:bg-red-900 dark:border-red-700 dark:text-red-200">
            {ocrError}
          </div>
        )}

        {lastIrrelevantSummary && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-4 py-3 rounded dark:bg-yellow-900 dark:border-yellow-700 dark:text-yellow-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-semibold">생산 카운터 이미지가 아닙니다</div>
                <div className="text-sm mt-1">{lastIrrelevantSummary}</div>
              </div>
            </div>
          </div>
        )}

        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 dark:text-white">
              <Camera className="w-5 h-5" />
              카메라 스캔
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleCameraScan}
              disabled={isScanning}
              className="w-full bg-blue-600 hover:bg-blue-700 text-lg py-6"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  이미지 분석 중...
                </>
              ) : (
                <>
                  <Camera className="w-5 h-5 mr-2" />
                  사진 촬영
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleImageCapture}
              className="hidden"
            />
            <div className="mt-2 text-sm text-gray-500 dark:text-gray-400 text-center">
              마지막 스캔: {getTimeSinceLastScan()}
            </div>
          </CardContent>
        </Card>

        {chartData.length > 0 && (
          <Card className="dark:bg-gray-800 dark:border-gray-700">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 dark:text-white">
                <TrendingUp className="w-5 h-5" />
                생산 추이
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="time" />
                  <YAxis />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="bg-white dark:bg-gray-800 p-2 border rounded shadow">
                            <p className="text-sm font-semibold">{label}</p>
                            <p className="text-sm text-blue-600">박스: {payload[0]?.payload?.boxes}</p>
                            <p className="text-sm text-green-600">병: {payload[0]?.payload?.bottles}</p>
                            <p className="text-sm text-purple-600">BPM: {payload[0]?.payload?.bpm}</p>
                          </div>
                        )
                      }
                      return null
                    }}
                  />
                  <Area type="monotone" dataKey="bottles" stroke="#3b82f6" fill="#93c5fd" name="병" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        <Card className="dark:bg-gray-800 dark:border-gray-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 dark:text-white">
              <FileText className="w-5 h-5" />
              최근 기록
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {logs.length === 0 ? (
                <div className="text-center text-gray-500 dark:text-gray-400 py-8">아직 기록이 없습니다</div>
              ) : (
                logs
                  .slice()
                  .reverse()
                  .map((log) => (
                    <div
                      key={log.id}
                      className={`border rounded-lg p-3 ${
                        log.isRelevant
                          ? "bg-white dark:bg-gray-700 dark:border-gray-600"
                          : "bg-gray-100 dark:bg-gray-800 dark:border-gray-600 opacity-75"
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1">
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            {formatKST(log.timestamp, "M월 d일, HH:mm:ss")}
                          </div>
                          {log.isRelevant ? (
                            <>
                              <div className="font-semibold mt-1 dark:text-white">
                                {log.boxes.toLocaleString()} 박스 ({log.bottles.toLocaleString()} 병)
                              </div>
                              <div className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                속도: {log.bpm} BPM{" "}
                                <span className={
                                  log.status === "정상" ? "text-green-600 dark:text-green-400" :
                                  log.status === "느림" ? "text-orange-600 dark:text-orange-400" :
                                  "text-gray-600 dark:text-gray-400"
                                }>
                                  ({log.status})
                                </span>
                              </div>
                            </>
                          ) : (
                            <div className="mt-1">
                              <span className="inline-block px-2 py-1 bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-xs rounded">
                                관련 없는 이미지
                              </span>
                              {log.summary && (
                                <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                  {log.summary}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        {log.isRelevant && (
                          <Button variant="ghost" size="sm" onClick={() => handleEditLog(log)}>
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      {log.imageUrl && (
                        <img
                          src={log.imageUrl || "/placeholder.svg"}
                          alt="스캔 이미지"
                          className="w-full rounded mt-2"
                        />
                      )}
                    </div>
                  ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showTimeInputDialog} onOpenChange={setShowTimeInputDialog}>
        <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="dark:text-white">촬영 시간 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {capturedImage && (
              <div className="mb-4">
                <img src={capturedImage || "/placeholder.svg"} alt="촬영된 이미지" className="w-full rounded-lg" />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="photo-date" className="dark:text-white">날짜</Label>
              <Input
                id="photo-date"
                type="date"
                value={photoDate}
                onChange={(e) => setPhotoDate(e.target.value)}
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="photo-time" className="dark:text-white">시간</Label>
              <Input
                id="photo-time"
                type="time"
                value={photoTime}
                onChange={(e) => setPhotoTime(e.target.value)}
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTimeInputDialog(false)}>
              취소
            </Button>
            <Button onClick={handleConfirmPhotoTime}>확인</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editingLog !== null} onOpenChange={(open) => !open && setEditingLog(null)}>
        <DialogContent className="dark:bg-gray-800 dark:border-gray-700">
          <DialogHeader>
            <DialogTitle className="dark:text-white">수량 수정</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-boxes" className="dark:text-white">박스 수량</Label>
              <Input
                id="edit-boxes"
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                min="0"
                className="dark:bg-gray-700 dark:border-gray-600 dark:text-white"
              />
              <div className="text-sm text-gray-500 dark:text-gray-400">
                병 수량: {(Number.parseInt(editValue) || 0) * 100} 병
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingLog(null)}>
              취소
            </Button>
            <Button onClick={handleSaveEdit}>저장</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
