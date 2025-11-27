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

    const apiKey = process.env.GOOGLE_VISION_API_KEY

    if (!apiKey) {
      console.error("[OCR API] GOOGLE_VISION_API_KEY 환경 변수 미설정")
      return NextResponse.json(
        {
          error: "API_KEY_MISSING",
          message: "GOOGLE_VISION_API_KEY가 설정되지 않았습니다. Vars 섹션에서 환경 변수를 추가해주세요.",
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

    console.log("[OCR API] Vision API 호출 시작")
    const apiUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            image: {
              content: base64Data,
            },
            features: [
              {
                type: "TEXT_DETECTION",
                maxResults: 50,
              },
            ],
            imageContext: {
              languageHints: ["ko", "en"],
            },
          },
        ],
      }),
    })

    console.log("[OCR API] Vision API 응답 상태:", response.status, response.statusText)

    if (!response.ok) {
      const errorText = await response.text()
      console.error("[OCR API] Vision API 오류 응답:", errorText)

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
            message: "API 키가 유효하지 않습니다. Vars 섹션에서 올바른 GOOGLE_VISION_API_KEY를 설정해주세요.",
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
          message: "Vision API 오류가 발생했습니다.",
          details: errorData,
        },
        { status: 500 },
      )
    }

    const data = await response.json()
    console.log("[OCR API] Vision API 성공")

    if (!data.responses || !data.responses[0]) {
      console.error("[OCR API] 응답 구조 이상")
      return NextResponse.json({
        error: "INVALID_RESPONSE",
        message: "응답 형식이 올바르지 않습니다.",
        number: null,
      })
    }

    const firstResponse = data.responses[0]

    if (firstResponse.error) {
      console.error("[OCR API] Vision API 에러:", firstResponse.error)
      return NextResponse.json({
        error: "VISION_ERROR",
        message: firstResponse.error.message || "Vision API 처리 오류",
        number: null,
      })
    }

    if (!firstResponse.textAnnotations || firstResponse.textAnnotations.length === 0) {
      console.log("[OCR API] 텍스트 미인식")
      return NextResponse.json({
        error: "NO_TEXT",
        message: "이미지에서 텍스트를 찾을 수 없습니다.",
        number: null,
      })
    }

    const allTexts: string[] = firstResponse.textAnnotations.map((a: any) => a.description).filter(Boolean)
    console.log("[OCR API] 인식된 텍스트 샘플:", allTexts.slice(0, 10))

    const allNumbers: number[] = []
    for (const text of allTexts) {
      const cleanedText = text.replace(/[,\s]/g, "")
      const numbers = cleanedText.match(/\d+/g)
      if (numbers) {
        numbers.forEach((num) => {
          const parsed = Number.parseInt(num, 10)
          if (!isNaN(parsed) && parsed > 0) {
            allNumbers.push(parsed)
          }
        })
      }
    }

    console.log("[OCR API] 추출된 모든 숫자:", allNumbers)

    if (allNumbers.length === 0) {
      console.log("[OCR API] 숫자 미발견")
      return NextResponse.json({
        error: "NO_NUMBERS",
        message: "숫자를 인식할 수 없습니다.",
        number: null,
      })
    }

    const fourDigitNumbers = allNumbers.filter((n) => n >= 1000 && n <= 9999)
    const threeDigitNumbers = allNumbers.filter((n) => n >= 100 && n <= 999)
    const twoDigitNumbers = allNumbers.filter((n) => n >= 10 && n <= 99)

    let selectedNumber: number

    if (fourDigitNumbers.length > 0) {
      selectedNumber = Math.max(...fourDigitNumbers)
      console.log("[OCR API] 4자리 숫자 선택:", selectedNumber)
    } else if (threeDigitNumbers.length > 0) {
      selectedNumber = Math.max(...threeDigitNumbers)
      console.log("[OCR API] 3자리 숫자 선택:", selectedNumber)
    } else if (twoDigitNumbers.length > 0) {
      selectedNumber = Math.max(...twoDigitNumbers)
      console.log("[OCR API] 2자리 숫자 선택:", selectedNumber)
    } else {
      selectedNumber = Math.max(...allNumbers)
      console.log("[OCR API] 최대값 선택:", selectedNumber)
    }

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
