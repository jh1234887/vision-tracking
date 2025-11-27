import { type NextRequest, NextResponse } from "next/server"

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

    console.log("[OCR API] API 키 확인 완료 (길이:", apiKey.length, ")")

    let base64Data = image
    if (image.includes(",")) {
      base64Data = image.split(",")[1]
    }
    base64Data = base64Data.replace(/\s/g, "")
    console.log("[OCR API] Base64 처리 완료, 길이:", base64Data.length)

    // MIME 타입 추출
    let mimeType = "image/jpeg"
    if (image.startsWith("data:")) {
      const mimeMatch = image.match(/data:([^;]+);/)
      if (mimeMatch) {
        mimeType = mimeMatch[1]
      }
    }

    console.log("[OCR API] Gemini API 호출 시작")
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro-preview-06-05:generateContent?key=${apiKey}`

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `이 이미지에서 생산 카운터의 숫자를 읽어주세요.

규칙:
1. 이미지에 보이는 숫자들 중 가장 큰 숫자를 찾아주세요.
2. 숫자만 응답해주세요. 다른 설명은 필요 없습니다.
3. 숫자를 찾을 수 없으면 "NO_NUMBER"라고 응답해주세요.
4. 콤마나 공백이 포함된 숫자는 제거하고 순수한 숫자만 반환해주세요.

예시 응답: 1234`,
              },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 100,
        },
      }),
    })

    console.log("[OCR API] Gemini API 응답 상태:", response.status, response.statusText)

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[OCR API] Gemini API 오류 응답:", errorText)

      let errorData: any = {}
      try {
        errorData = JSON.parse(errorText)
      } catch {
        errorData = { message: errorText }
      }

      if (response.status === 400) {
        return NextResponse.json(
          {
            error: "INVALID_REQUEST",
            message: "잘못된 API 요청입니다. API 키를 확인해주세요.",
            details: errorData,
          },
          { status: 400 },
        )
      }

      if (response.status === 403) {
        return NextResponse.json(
          {
            error: "API_KEY_INVALID",
            message: "API 키가 유효하지 않습니다. Vars 섹션에서 올바른 GEMINI_API_KEY를 설정해주세요.",
            details: errorData,
          },
          { status: 403 },
        )
      }

      if (response.status === 413) {
        return NextResponse.json(
          {
            error: "IMAGE_TOO_LARGE",
            message: "이미지가 너무 큽니다.",
          },
          { status: 413 },
        )
      }

      return NextResponse.json(
        {
          error: "API_ERROR",
          message: "Gemini API 오류가 발생했습니다.",
          details: errorData,
        },
        { status: 500 },
      )
    }

    const data = await response.json()
    console.log("[OCR API] Gemini API 성공")

    if (!data.candidates || !data.candidates[0]) {
      console.error("[OCR API] 응답 구조 이상:", JSON.stringify(data))
      return NextResponse.json({
        error: "INVALID_RESPONSE",
        message: "응답 형식이 올바르지 않습니다.",
        number: null,
      })
    }

    const candidate = data.candidates[0]

    if (candidate.finishReason === "SAFETY") {
      console.error("[OCR API] 안전 필터에 의해 차단됨")
      return NextResponse.json({
        error: "SAFETY_BLOCKED",
        message: "이미지가 안전 필터에 의해 차단되었습니다.",
        number: null,
      })
    }

    const textContent = candidate.content?.parts?.[0]?.text
    if (!textContent) {
      console.log("[OCR API] 텍스트 미인식")
      return NextResponse.json({
        error: "NO_TEXT",
        message: "이미지에서 텍스트를 찾을 수 없습니다.",
        number: null,
      })
    }

    console.log("[OCR API] Gemini 응답:", textContent)

    // "NO_NUMBER" 응답 처리
    if (textContent.trim().toUpperCase() === "NO_NUMBER") {
      console.log("[OCR API] 숫자 미발견")
      return NextResponse.json({
        error: "NO_NUMBERS",
        message: "숫자를 인식할 수 없습니다.",
        number: null,
      })
    }

    // 숫자 추출
    const cleanedText = textContent.replace(/[,\s]/g, "")
    const numbers = cleanedText.match(/\d+/g)

    if (!numbers || numbers.length === 0) {
      console.log("[OCR API] 숫자 미발견")
      return NextResponse.json({
        error: "NO_NUMBERS",
        message: "숫자를 인식할 수 없습니다.",
        number: null,
      })
    }

    const allNumbers = numbers.map((num) => Number.parseInt(num, 10)).filter((n) => !isNaN(n) && n > 0)
    console.log("[OCR API] 추출된 모든 숫자:", allNumbers)

    if (allNumbers.length === 0) {
      console.log("[OCR API] 유효한 숫자 없음")
      return NextResponse.json({
        error: "NO_NUMBERS",
        message: "숫자를 인식할 수 없습니다.",
        number: null,
      })
    }

    // 가장 큰 숫자 선택
    const selectedNumber = Math.max(...allNumbers)

    console.log("[OCR API] 최종 인식 숫자:", selectedNumber)
    return NextResponse.json({ number: selectedNumber })
  } catch (error) {
    console.error("[OCR API] 예외 발생:", error)
    console.error("[OCR API] 에러 스택:", error instanceof Error ? error.stack : "스택 없음")
    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: "서버 내부 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
        number: null,
      },
      { status: 500 },
    )
  }
}
