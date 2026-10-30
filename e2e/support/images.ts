import type { Page } from '@playwright/test'

export async function makeSupportedImageFiles(page: Page) {
    const encodedFiles = await page.evaluate(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 3
        canvas.height = 2
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas unavailable')
        context.fillStyle = '#e85d3f'
        context.fillRect(0, 0, 2, 2)
        context.fillStyle = '#287a70'
        context.fillRect(2, 0, 1, 2)

        const asFile = (name: string, mimeType: string, dataUrl: string) => ({
            name,
            mimeType,
            base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
        })
        const encoded = (mimeType: string) => canvas.toDataURL(mimeType)
        const bmp = new Uint8Array(58)
        const bmpView = new DataView(bmp.buffer)
        bmp[0] = 0x42
        bmp[1] = 0x4d
        bmpView.setUint32(2, bmp.length, true)
        bmpView.setUint32(10, 54, true)
        bmpView.setUint32(14, 40, true)
        bmpView.setInt32(18, 1, true)
        bmpView.setInt32(22, 1, true)
        bmpView.setUint16(26, 1, true)
        bmpView.setUint16(28, 24, true)
        bmpView.setUint32(34, 4, true)
        bmp.set([0x70, 0x7a, 0x28], 54)
        const bmpDataUrl = `data:image/bmp;base64,${btoa(String.fromCharCode(...bmp))}`
        const gif = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
        const svg = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="3" height="2"><rect width="3" height="2" fill="#287a70"/></svg>')}`
        return [
            asFile('pixel.png', 'image/png', encoded('image/png')),
            asFile('pixel.jpg', 'image/jpeg', encoded('image/jpeg')),
            asFile('pixel.jpeg', 'image/jpeg', encoded('image/jpeg')),
            asFile('pixel.jfif', 'image/jpeg', encoded('image/jpeg')),
            asFile('pixel.webp', 'image/webp', encoded('image/webp')),
            asFile('pixel.gif', 'image/gif', gif),
            asFile('pixel.bmp', 'image/bmp', bmpDataUrl),
            asFile('pixel.svg', 'image/svg+xml', svg),
        ]
    })

    return encodedFiles.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        buffer: Buffer.from(file.base64, 'base64'),
    }))
}
