import { type NextRequest, NextResponse } from "next/server"
import { GoogleGenerativeAI } from "@google/generative-ai"

// API 응답 타입 정의
interface ProductionData {
  isRelevant: boolean
  operatingLine: string | null      // 운영라인
  productionDate: string | null     // 생산일
  plannedQuantity: number | null    // 생산계획량
  productName: string | null        // 제품명
  completedQuantity: number | null  // 생산완료량
  lotNo: string | null              // LOT NO
  summary: string
  rawText: string
}

export async function POST(request: NextRequest) {
  try {
    console.log("[OCR API] 요청 수신")

    const { image } = await request.json()

    if (!image) {
      console.error("[OCR API] 이미지 데이터 없음")
      return NextResponse.json(
        {
          error: "NO_IMAGE",
          message: "이미지 데이터가 없습니다.",
        },
        { status: 400 },
      )
    }

    console.log("[OCR API] 이미지 길이:", image.length, "문자")

    const apiKey = process.env.GEMINI_API_KEY

    if (!apiKey) {
      console.error("[OCR API] GEMINI_API_KEY 환경 변수 미설정")
      return NextResponse.json(
        {
          error: "API_KEY_MISSING",
          message: "GEMINI_API_KEY가 설정되지 않았습니다. Vars 섹션에서 환경 변수를 추가해주세요.",
        },
        { status: 500 },
      )
    }

    // Base64 데이터 추출
    let base64Data = image
    if (image.includes(",")) {
      base64Data = image.split(",")[1]
    }
    base64Data = base64Data.replace(/\s/g, "")

    // MIME 타입 추출
    let mimeType = "image/jpeg"
    if (image.startsWith("data:")) {
      const mimeMatch = image.match(/data:([^;]+);/)
      if (mimeMatch) {
        mimeType = mimeMatch[1]
      }
    }

    // Google AI SDK 초기화
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" })

    console.log("[OCR API] Gemini API 호출 시작")

    const prompt = `당신은 공장 생산 라인 모니터링 시스템의 이미지 분석 AI입니다.
이 이미지를 분석하고 아래 JSON 형식으로만 응답해주세요. 다른 텍스트는 절대 포함하지 마세요.

분석 규칙:
1. 생산 현황판, 디지털 디스플레이, 생산 정보를 보여주는 이미지인지 확인합니다.
2. 관련 이미지라면 다음 정보를 추출합니다:
   - operatingLine: 운영라인 (예: "1호기", "A라인" 등, 없으면 null) - A, B, C 위에 동그라미 그려진 것을 선택
   - productionDate: 생산일 (YYYY-MM-DD 형식, 없으면 null) - 현재 날짜기준 1년 이상 차이나지 않음. 
   - plannedQuantity: 생산계획량 (숫자, 없으면 null)
   - productName: 제품명 (없으면 null)
   - completedQuantity: 생산완료량 (숫자, 없으면 null)
   - lotNo: LOT NO 또는 로트번호 (없으면 null)
3. 관련 없는 이미지라면 이미지 내용을 요약합니다.

JSON 응답 형식:
{
  "isRelevant": true 또는 false,
  "operatingLine": "라인명" 또는 null,
  "productionDate": "YYYY-MM-DD" 또는 null,
  "plannedQuantity": 숫자 또는 null,
  "productName": "제품명" 또는 null,
  "completedQuantity": 숫자 또는 null,
  "lotNo": "LOT 번호" 또는 null,
  "summary": "이미지 설명 (관련 없는 경우 상세히, 관련 있는 경우 간단히)"
}

예시 1 (생산 현황판 이미지):
{
  "isRelevant": true,
  "operatingLine": "1호기",
  "productionDate": "2025-11-28",
  "plannedQuantity": 5000,
  "productName": "생수 500ml",
  "completedQuantity": 3450,
  "lotNo": "LOT-20251128-001",
  "summary": "생산 현황판 디스플레이"
}

예시 2 (관련 없는 이미지):
{
  "isRelevant": false,
  "operatingLine": null,
  "productionDate": null,
  "plannedQuantity": null,
  "productName": null,
  "completedQuantity": null,
  "lotNo": null,
  "summary": "사무실 풍경 사진입니다. 책상, 컴퓨터, 의자가 보입니다."
}

JSON만 응답하세요:`

    const imagePart = {
      inlineData: {
        data: base64Data,
        mimeType: mimeType,
      },
    }

    const result = await model.generateContent([prompt, imagePart])
    const response = result.response
    const textContent = response.text()

    console.log("[OCR API] Gemini 원본 응답:", textContent)

    // JSON 파싱
    let parsedData: any
    try {
      // JSON 블록 추출 (```json ... ``` 형식 처리)
      let jsonStr = textContent
      const jsonMatch = textContent.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) {
        jsonStr = jsonMatch[1]
      } else {
        // { } 블록 추출
        const braceMatch = textContent.match(/\{[\s\S]*\}/)
        if (braceMatch) {
          jsonStr = braceMatch[0]
        }
      }
      parsedData = JSON.parse(jsonStr)
    } catch (parseError) {
      console.error("[OCR API] JSON 파싱 실패:", parseError)
      // 파싱 실패 시 기본 응답
      return NextResponse.json({
        isRelevant: false,
        operatingLine: null,
        productionDate: null,
        plannedQuantity: null,
        productName: null,
        completedQuantity: null,
        lotNo: null,
        summary: "이미지 분석 결과를 파싱할 수 없습니다: " + textContent,
        rawText: textContent,
      })
    }

    const responseData: ProductionData = {
      isRelevant: parsedData.isRelevant ?? false,
      operatingLine: parsedData.operatingLine ?? null,
      productionDate: parsedData.productionDate ?? null,
      plannedQuantity: parsedData.plannedQuantity ?? null,
      productName: parsedData.productName ?? null,
      completedQuantity: parsedData.completedQuantity ?? null,
      lotNo: parsedData.lotNo ?? null,
      summary: parsedData.summary ?? "",
      rawText: textContent,
    }

    console.log("[OCR API] 최종 응답:", responseData)
    return NextResponse.json(responseData)

  } catch (error: any) {
    console.error("[OCR API] 예외 발생:", error)
    console.error("[OCR API] 에러 메시지:", error?.message)

    const errorMessage = error?.message || String(error)

    if (errorMessage.includes("API_KEY_INVALID") || errorMessage.includes("API key not valid")) {
      return NextResponse.json(
        {
          error: "API_KEY_INVALID",
          message: "API 키가 유효하지 않습니다. 올바른 GEMINI_API_KEY를 설정해주세요.",
        },
        { status: 403 },
      )
    }

    if (errorMessage.includes("SAFETY")) {
      return NextResponse.json({
        error: "SAFETY_BLOCKED",
        message: "이미지가 안전 필터에 의해 차단되었습니다.",
      })
    }

    if (errorMessage.includes("quota") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json(
        {
          error: "QUOTA_EXCEEDED",
          message: "API 할당량이 초과되었습니다. 잠시 후 다시 시도해주세요.",
        },
        { status: 429 },
      )
    }

    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: "서버 내부 오류가 발생했습니다.",
        details: errorMessage,
      },
      { status: 500 },
    )
  }
}
